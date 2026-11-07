import type { ChangeEvent as ReactChangeEvent } from "react";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { reflectDocumentToWiki, uploadDocumentFile } from "@/entities/document/api/document";
import { describeLimitError, invalidateStorageUsage, useSelectedWorkspace } from "@/entities/workspace";
import {
  appendItemsToFolder,
  availableDocumentName,
  serverFolderId,
  applyUploadedDocument,
  createClientId,
  findTreeItem,
  isSupportedUploadFile,
  updateTreeItemStatus
} from "@/entities/tree";
import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { FileDropTarget, Project, UploadPickerTarget } from "@/entities/tree/model/tree";
import { captureAnalytics } from "@/shared/lib/analytics/client";
import { newAnalyticsId } from "@/shared/lib/analytics/events";
import { ApiError, getErrorMessage } from "@/shared/lib/apiErrors";
import { publishNotice } from "@/features/document-notifications";
import { autoIngestContextOf, shouldAutoIngestUpload } from "@/features/wiki-ingest/model/autoIngestPolicy";
import { useWikiActionPermissions } from "@/features/wiki-ingest/model/useWikiActionPermissions";
import { saveNoteDraft } from "@/features/note-editing/api/note";
import { ZipSafetyError } from "@/shared/lib/markdown-import/zipArchive";
import { countMissingImages, isImagePath, isMarkdownPath, planMarkdownBundle, type BundleDocument, type BundleFile } from "../lib/markdownBundle";
import { bundleFilesFromSelection, bundleFromZip, isZipFile } from "./markdownBundleSources";
import { uploadMarkdownBundleDocument } from "./markdownBundleUpload";

/** autoIngest: 업로드가 끝나면 바로 위키 편입을 요청할 문서인지(일반 업로드의 Markdown·txt). 새 노트는 빈 본문이라 뺀다. */
type UploadTask = { label: string; autoIngest: boolean; run: () => Promise<DocumentItemResponse> };

function baseName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function useDocumentUpload({
  projects,
  setProjects,
  setDocuments,
  setFileDropTarget,
  refreshBackendData,
  onNotionZip
}: {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setDocuments: React.Dispatch<React.SetStateAction<DocumentItemResponse[]>>;
  setFileDropTarget: React.Dispatch<React.SetStateAction<FileDropTarget | null>>;
  refreshBackendData: () => Promise<void>;
  /** Notion 내보내기 모양의 zip은 Notion 가져오기로 넘긴다. folderId는 서버 폴더 ID(null이면 최상위). */
  onNotionZip?: (file: File, folderId: string | null) => void;
}) {
  const t = useTranslations("documents.upload");
  const queryClient = useQueryClient();
  const uploadPickerTargetRef = useRef<UploadPickerTarget | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [hasRejectedFiles, setHasRejectedFiles] = useState(false);
  // Markdown 업로드 자동 편입. 서버가 편입하는 설정이면 보내지 않고, 구 서버에서 설정이 꺼져 있을 때만 프론트가 요청한다(shouldAutoIngestUpload).
  const { canIngest } = useWikiActionPermissions();
  const workspace = useSelectedWorkspace();
  const autoIngestContext = autoIngestContextOf(workspace, canIngest);

  /** 업로드 실패 알림: 어떤 파일이 왜 실패했는지 함께 보인다. */
  function noticeUploadFailed(filename: string, reason: string) {
    publishNotice({ kind: "failed", notificationKey: "uploadFailed", title: t("failed.title"), message: t("failed.message", { filename, reason }) });
  }

  /** 본문이 가리키는데 함께 받지 못한 그림 안내(빠른 경고). */
  function noticeMissingImages(fileName: string, count: number) {
    if (count > 0) publishNotice({ kind: "info", notificationKey: "uploadFailed", title: t("missingImages.title"), message: t("missingImages.message", { filename: fileName, count }) });
  }

  function openUploadPicker(projectId: string, folderId: string | null) {
    uploadPickerTargetRef.current = { projectId, folderId };
    uploadInputRef.current?.click();
  }

  function handleUploadPickerChange(event: ReactChangeEvent<HTMLInputElement>) {
    const target = uploadPickerTargetRef.current;
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!target || files.length === 0) return;
    dropUploadFiles(target.projectId, target.folderId, files);
  }

  /**
   * 업로드가 끝나면 파일별 서버 응답(실패면 null)으로 풀린다. 저장 용량은 서버가 판단한다(STORAGE_QUOTA_EXCEEDED).
   * .md와 그림을 함께 고르거나 zip(Notion이 아닌 것)을 올리면 그림을 문서 첨부로 넣는다.
   */
  function dropUploadFiles(projectId: string, folderId: string | null, files: File[]): Promise<(DocumentItemResponse | null)[]> {
    return startUploads(projectId, folderId, files, true);
  }

  function startUploads(projectId: string, folderId: string | null, files: File[], autoIngest: boolean): Promise<(DocumentItemResponse | null)[]> {
    setFileDropTarget(null);
    const serverFolder = serverFolderId(projects, { projectId, folderId });
    const zips = files.filter(isZipFile);
    const images = files.filter((file) => isImagePath(file.name));
    // 그림이나 zip이 없으면 지금처럼 파일마다 올린다.
    if (zips.length === 0 && images.length === 0) {
      return runUploads(projectId, folderId, plainUploadTasks(files, serverFolder, autoIngest));
    }
    const plainFiles = files.filter((file) => !isZipFile(file) && !isImagePath(file.name) && !isMarkdownPath(file.name));
    return collectBundleDocuments(files, zips, serverFolder).then((documents) => runUploads(projectId, folderId, [
      ...plainUploadTasks(plainFiles, serverFolder, autoIngest),
      ...documents.map((document) => bundleUploadTask(document, serverFolder, autoIngest))
    ]));
  }

  /** 그림 없이 올리는 파일. .md 본문이 상대 그림을 가리키면 빠졌다고 알린다(업로드는 막지 않는다). */
  function plainUploadTasks(files: File[], serverFolder: string | null, autoIngest: boolean): UploadTask[] {
    const uploadFiles = files.filter(isSupportedUploadFile);
    if (uploadFiles.length < files.length) {
      setHasRejectedFiles(true);
      captureAnalytics("upload_failed_shown", { upload_attempt_id: newAnalyticsId(), reason: "unsupported_type" });
    }
    return uploadFiles.map((file) => ({
      label: file.name,
      autoIngest,
      run: () => {
        if (isMarkdownPath(file.name)) {
          void file.text().then((markdown) => noticeMissingImages(file.name, countMissingImages(markdown, file.name))).catch(() => {});
        }
        return uploadDocumentFile(file, serverFolder) as Promise<DocumentItemResponse>;
      }
    }));
  }

  /** 고른 .md·그림과 zip 안 파일을 문서 묶음으로 만든다. Notion zip은 Notion 가져오기로 넘긴다. */
  async function collectBundleDocuments(files: File[], zips: File[], serverFolder: string | null): Promise<BundleDocument[]> {
    const groups: BundleFile[][] = [bundleFilesFromSelection(files.filter((file) => !isZipFile(file)))];
    for (const zip of zips) {
      try {
        const bundle = await bundleFromZip(zip);
        if (bundle.kind === "notion") {
          if (onNotionZip) onNotionZip(zip, serverFolder);
          else noticeUploadFailed(zip.name, t("zip.notion"));
          continue;
        }
        if (!bundle.files.some((file) => isMarkdownPath(file.path))) {
          noticeUploadFailed(zip.name, t("zip.noMarkdown"));
          continue;
        }
        groups.push(bundle.files);
      } catch (error) {
        const reason = error instanceof ZipSafetyError ? error.message : t("zip.unreadable");
        noticeUploadFailed(zip.name, reason);
      }
    }
    const documents: BundleDocument[] = [];
    let unused = 0;
    for (const group of groups) {
      const plan = await planMarkdownBundle(group);
      documents.push(...plan.documents);
      unused += plan.unused.length;
    }
    if (unused > 0) {
      publishNotice({ kind: "info", notificationKey: "uploadFailed", title: t("imagesSkipped.title"), message: t("imagesSkipped.unused", { count: unused }) });
    }
    return documents;
  }

  function bundleUploadTask(document: BundleDocument, serverFolder: string | null, autoIngest: boolean): UploadTask {
    const name = baseName(document.file.path);
    return {
      label: name,
      // 그림을 본문에 넣은 뒤(run이 끝난 뒤) 편입해 그림 자리까지 위키에 들어가게 한다.
      autoIngest,
      run: async () => {
        noticeMissingImages(name, document.missing.length);
        const result = await uploadMarkdownBundleDocument(document, {
          uploadMarkdown: (file) => uploadDocumentFile(file, serverFolder) as Promise<DocumentItemResponse>,
          saveContent: (documentId, markdown, baseVersion, attachments) => saveNoteDraft(
            documentId, markdown, baseVersion, undefined, undefined, attachments.map((attachment) => ({ ...attachment, objectUrl: "" })))
        });
        if (result.rejected.length > 0) {
          publishNotice({ kind: "info", notificationKey: "uploadFailed", title: t("imagesSkipped.title"), message: t("imagesSkipped.rejected", { filename: name, count: result.rejected.length }) });
        }
        if (result.failed) {
          const error = result.failed.error;
          const reason = describeLimitError(error) ?? (error instanceof Error ? error.message : t("imageUploadFailed.fallback"));
          publishNotice({ kind: "failed", notificationKey: "uploadFailed", title: t("imageUploadFailed.title"), message: t("imageUploadFailed.message", { filename: name, count: result.failed.count, reason }) });
          if (error instanceof ApiError && error.code === "STORAGE_QUOTA_EXCEEDED") invalidateStorageUsage(queryClient);
        }
        return result.created;
      }
    };
  }

  /**
   * 일반 업로드로 올린 Markdown·txt를 바로 위키 편입 요청한다(shouldAutoIngestUpload). 실패해도 업로드는 성공으로 두고 알림만 띄운다.
   * 요청이 접수되면 다음 목록 갱신 전까지 진행 중으로 두어, 같은 문서에 "새 문서가 추가되었습니다" 편입 제안 카드가 뜨지 않게 한다.
   */
  async function ingestUploadedDocument(task: UploadTask, document: DocumentItemResponse): Promise<DocumentItemResponse> {
    if (!task.autoIngest || !shouldAutoIngestUpload(document, autoIngestContext)) return document;
    try {
      await reflectDocumentToWiki(document.id, "EDITABLE");
      return { ...document, status: "processing" };
    } catch (error) {
      publishNotice({ kind: "failed", notificationKey: "ingestFailed", title: t("ingestFailed.title"), message: t("ingestFailed.message", { filename: document.filename, reason: getErrorMessage(error, t("ingestFailed.fallback")) }) });
      return document;
    }
  }

  function runUploads(projectId: string, folderId: string | null, tasks: UploadTask[]): Promise<(DocumentItemResponse | null)[]> {
    if (tasks.length === 0) return Promise.resolve([]);

    // 작업과 업로드 항목을 쌍으로 묶어 인덱스 기반 병렬 배열 접근을 피한다.
    const uploads = tasks.map((task) => ({
      task,
      attemptId: newAnalyticsId(),
      item: {
        id: createClientId("upload"),
        label: task.label,
        type: "file" as const,
        status: "uploading" as const
      }
    }));
    const uploadItems = uploads.map(({ item }) => item);

    setProjects((current) => current.map((project) => {
      if (project.id !== projectId) return project;
      return { ...project, items: appendItemsToFolder(project.items, folderId, uploadItems) };
    }));

    return Promise.all(uploads.map(({ task, item, attemptId }) => {
      return task.run()
        .then((uploaded) => ingestUploadedDocument(task, uploaded))
        .then((response) => {
          setDocuments((current) => {
            const withoutCurrent = current.filter((document) => document.id !== response.id);
            return [...withoutCurrent, response];
          });
          setProjects((current) => current.map((project) => {
            if (!findTreeItem(project.items, item.id)) return project;
            return { ...project, items: applyUploadedDocument(project.items, item.id, response) };
          }));
          void refreshBackendData();
          invalidateStorageUsage(queryClient);
          return response;
        })
        .catch((error: Error) => {
          captureAnalytics("upload_failed_shown", { upload_attempt_id: attemptId, reason: error instanceof ApiError
            ? error.status === 413 ? "file_too_large" : error.status === 403 ? "permission" : error.status >= 500 ? "server_error" : "unknown"
            : error instanceof TypeError ? "network" : "unknown" });
          const message = describeLimitError(error) ?? error.message;
          setProjects((current) => current.map((project) => {
            if (!findTreeItem(project.items, item.id)) return project;
            return { ...project, items: updateTreeItemStatus(project.items, item.id, "failed", message) };
          }));
          // 행 tooltip만으로는 실패 사유가 보이지 않으므로 알림 카드(role=alert)로 파일 이름과 함께 띄운다.
          noticeUploadFailed(task.label, message);
          if (error instanceof ApiError && error.code === "STORAGE_QUOTA_EXCEEDED") invalidateStorageUsage(queryClient);
          // 서버가 거절한 경우에도 최신 목록으로 맞춘다.
          void refreshBackendData().catch(() => {});
          return null;
        });
    }));
  }

  /** 새 노트를 업로드한다. 만들어진 문서(실패면 null)로 풀린다. */
  async function createMarkdownFile(projectId: string, folderId: string | null): Promise<DocumentItemResponse | null> {
    const noteId = createClientId("note");
    // 본문은 비워 두고 편집기 placeholder로 안내한다. 제목은 파일 이름 input이 맡는다.
    const markdown = `<!-- fruition-note: ${noteId} -->\n`;
    const file = new File([markdown], availableDocumentName(projects, `${t("newNoteName")}.md`, { projectId, folderId }), { type: "text/markdown" });
    const [created] = await startUploads(projectId, folderId, [file], false);
    return created ?? null;
  }

  return {
    uploadInputRef,
    openUploadPicker,
    handleUploadPickerChange,
    dropUploadFiles,
    createMarkdownFile,
    hasRejectedFiles,
    clearRejectedFiles: () => setHasRejectedFiles(false)
  };
}
