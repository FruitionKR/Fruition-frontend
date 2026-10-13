import type { DragEvent as ReactDragEvent } from "react";
import type { Project, TreeItem } from "@/entities/tree/model/tree";
import { SUPPORTED_UPLOAD_EXTENSIONS } from "@/entities/document/lib/documentKind";

// 서버 트리를 받기 전 빈 루트. id·title은 serverTree.ts의 상수와 같다.
export const initialProjects: Project[] = [
  {
    id: "project-uploaded-documents",
    folderId: null,
    title: "문서",
    items: []
  }
];

export function isFileItem(item: TreeItem) {
  return item.type === "file";
}

export function isWikiItem(item: TreeItem) {
  return item.type === "wiki";
}

export function canDragTreeItem(item: TreeItem) {
  if (isWikiItem(item) && item.wikiKind) return true;
  return !item.generated && !isWikiItem(item);
}

export function isSupportedUploadFile(file: File) {
  const name = file.name.toLowerCase();
  return SUPPORTED_UPLOAD_EXTENSIONS.some((extension) => name.endsWith(extension));
}

// 미지원 파일 필터링은 dropUploadFiles에서 처리한다(거부 안내 모달 표시를 위해 원본 목록 유지).
export function getDroppedFiles(event: ReactDragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.files);
}

export function hasDroppedFiles(event: ReactDragEvent<HTMLElement>) {
  return event.dataTransfer.types.includes("Files");
}

export function createClientId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
