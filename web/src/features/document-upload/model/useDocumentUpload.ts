import type { ChangeEvent as ReactChangeEvent } from "react";
import { useRef, useState } from "react";
import { uploadDocumentFile } from "@/entities/document/api/document";
import { checkStorageQuota, describeLimitError, fetchWorkspaceStorage } from "@/entities/workspace";
import { getWorkspaceId } from "@/shared/api/client";
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

// 용량 조회가 이보다 늦으면 사전 검사를 건너뛰고 업로드를 시작한다.
const STORAGE_CHECK_TIMEOUT_MS = 3_000;

/**
 * 업로드 전에 워크스페이스 남은 용량을 검사해 파일별 거절 문구(통과면 null)를 돌려준다.
 * 빠른 안내용 검사라서 용량을 조회하지 못하면(404·오류·시간 초과) 검사를 건너뛰고 서버 검사에 맡긴다.
 */
async function loadUploadRejections(files: File[]): Promise<(string | null)[]> {
  const skipped = files.map(() => null);
  // 용량 API가 없는(404) 워크스페이스는 fetchWorkspaceStorage가 다시 묻지 않고 null을 돌려준다.
  const storage = await fetchWorkspaceStorage(getWorkspaceId(), AbortSignal.timeout(STORAGE_CHECK_TIMEOUT_MS))
    .catch(() => null);
  if (!storage) return skipped;
  return checkStorageQuota(files.map((file) => file.size), storage);
}

export function useDocumentUpload({
  projects,
  setProjects,
  setDocuments,
  setFileDropTarget,
  refreshBackendData
}: {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setDocuments: React.Dispatch<React.SetStateAction<DocumentItemResponse[]>>;
  setFileDropTarget: React.Dispatch<React.SetStateAction<FileDropTarget | null>>;
  refreshBackendData: () => Promise<void>;
}) {
  const uploadPickerTargetRef = useRef<UploadPickerTarget | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [hasRejectedFiles, setHasRejectedFiles] = useState(false);

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
   * 업로드가 끝나면 파일별 서버 응답(실패면 null)으로 풀린다.
   * 새 노트처럼 용량에 영향이 거의 없는 업로드는 skipQuotaCheck로 사전 검사 왕복을 건너뛴다(서버가 최종 판단한다).
   */
  function dropUploadFiles(
    projectId: string,
    folderId: string | null,
    files: File[],
    { skipQuotaCheck = false }: { skipQuotaCheck?: boolean } = {}
  ): Promise<(DocumentItemResponse | null)[]> {
    const uploadFiles = files.filter(isSupportedUploadFile);
    setFileDropTarget(null);
    if (uploadFiles.length < files.length) setHasRejectedFiles(true);
    if (uploadFiles.length === 0) return Promise.resolve([]);

    // 파일과 업로드 항목을 쌍으로 묶어 인덱스 기반 병렬 배열 접근을 피한다.
    const uploads = uploadFiles.map((file) => ({
      file,
      item: {
        id: createClientId("upload"),
        label: file.name,
        type: "file" as const,
        status: "uploading" as const
      }
    }));
    const uploadItems = uploads.map(({ item }) => item);

    setProjects((current) => current.map((project) => {
      if (project.id !== projectId) return project;
      return { ...project, items: appendItemsToFolder(project.items, folderId, uploadItems) };
    }));

    const rejectionsPromise: Promise<(string | null)[]> = skipQuotaCheck ? Promise.resolve(uploadFiles.map(() => null)) : loadUploadRejections(uploadFiles);
    return rejectionsPromise.then((rejections) => Promise.all(uploads.map(({ file, item }, index) => {
      const rejection = rejections[index];
      const upload = rejection
        ? Promise.reject(new Error(rejection))
        : uploadDocumentFile(file, serverFolderId(projects, { projectId, folderId }));
      return upload
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
          return response;
        })
        .catch((error: Error) => {
          setProjects((current) => current.map((project) => {
            if (!findTreeItem(project.items, item.id)) return project;
            return { ...project, items: updateTreeItemStatus(project.items, item.id, "failed", describeLimitError(error) ?? error.message) };
          }));
          // 서버가 거절한 경우에도 최신 목록으로 맞춘다. 사전 검사로 막은 파일은 서버에 가지 않았으니 다시 받지 않는다.
          if (!rejection) void refreshBackendData().catch(() => {});
          return null;
        });
    })));
  }

  /** 새 노트를 업로드한다. 만들어진 문서(실패면 null)로 풀린다. */
  async function createMarkdownFile(projectId: string, folderId: string | null): Promise<DocumentItemResponse | null> {
    const noteId = createClientId("note");
    // 본문은 비워 두고 편집기 placeholder로 안내한다. 제목은 파일 이름 input이 맡는다.
    const markdown = `<!-- fruition-note: ${noteId} -->\n`;
    const file = new File([markdown], availableDocumentName(projects, "새 노트.md", { projectId, folderId }), { type: "text/markdown" });
    const [created] = await dropUploadFiles(projectId, folderId, [file], { skipQuotaCheck: true });
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
