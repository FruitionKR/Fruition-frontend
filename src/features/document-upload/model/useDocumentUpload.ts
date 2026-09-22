import type { ChangeEvent as ReactChangeEvent } from "react";
import { useRef, useState } from "react";
import { DocumentNameConflictError, uploadDocumentFile } from "@/entities/document/api/document";
import { publishNotice } from "@/features/document-notifications";
import {
  appendItemsToFolder,
  availableDocumentName,
  serverFolderId,
  applyUploadedDocument,
  createClientId,
  findTreeItem,
  isSupportedUploadFile,
  removeTreeItem,
  updateTreeItemStatus
} from "@/entities/tree";
import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { FileDropTarget, Project, UploadPickerTarget } from "@/entities/tree/model/tree";

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

  function dropUploadFiles(projectId: string, folderId: string | null, files: File[]) {
    const uploadFiles = files.filter(isSupportedUploadFile);
    setFileDropTarget(null);
    if (uploadFiles.length < files.length) setHasRejectedFiles(true);
    if (uploadFiles.length === 0) return;

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

    uploads.forEach(({ file, item }) => {
      void uploadDocumentFile(file, serverFolderId(projects, { projectId, folderId }))
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
        })
        .catch((error: Error) => {
          if (error instanceof DocumentNameConflictError) {
            setProjects((current) => current.map((project) => ({
              ...project,
              items: removeTreeItem(project.items, item.id).items
            })));
            publishNotice({ kind: "failed", title: "문서 이름 중복", message: error.message });
            // 다른 탭·사용자가 만든 문서도 중복 안내와 함께 목록에 반영한다.
            void refreshBackendData().catch(() => {});
            return;
          }
          setProjects((current) => current.map((project) => {
            if (!findTreeItem(project.items, item.id)) return project;
            return { ...project, items: updateTreeItemStatus(project.items, item.id, "failed", error.message) };
          }));
          // 사전 검사 이후 서버가 중복·버전 충돌로 거절한 경우도 재조회한다.
          void refreshBackendData().catch(() => {});
        });
    });
  }

  function createMarkdownFile(projectId: string, folderId: string | null) {
    const noteId = createClientId("note");
    const markdown = `<!-- fruition-note: ${noteId} -->\n# 새 노트\n`;
    const file = new File([markdown], availableDocumentName(projects, "새 노트.md", { projectId, folderId }), { type: "text/markdown" });
    dropUploadFiles(projectId, folderId, [file]);
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
