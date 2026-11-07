import { describeDocumentFailure } from "@/shared/lib/aiErrorCodes";
import type { SharedTranslate } from "@/shared/i18n/sharedTranslate";
import type { Project, TreeItem } from "../model/tree";
import type { ServerTreeItem } from "../model/serverTree";
import { makeRawId } from "@/entities/graph/lib/graphBuilder";
import { isDocumentBodyLocked } from "@/entities/document/lib/documentAccess";

export const ROOT_DOCUMENTS_PROJECT_ID = "project-uploaded-documents";
/** 최상위 묶음의 저장 이름. 화면에는 documents.tree.rootTitle을 쓴다(DocumentSearch·HomeWorkspace). */
export const ROOT_DOCUMENTS_TITLE = "문서";
const compareName = (a: string, b: string) => a.localeCompare(b, "ko", { numeric: true, sensitivity: "base" });
const withoutMd = (label: string) => label.replace(/\.md$/i, "");
// 확장자를 뺀 이름이 정확히 같은 문서와 폴더(Notion 하위 페이지)는 문서를 먼저 둔다. 나머지는 이름순 그대로다.
const byName = (a: { label: string; type?: string }, b: { label: string; type?: string }) => {
  if ((a.type === "folder") !== (b.type === "folder") && withoutMd(a.label) === withoutMd(b.label)) {
    return a.type === "folder" ? 1 : -1;
  }
  return compareName(a.label, b.label);
};

/**
 * 서버 트리가 위치의 기준이며, 아직 완료되지 않은 업로드만 화면에 유지한다.
 * 루트 문서와 루트 폴더를 하나의 트리로 묶는다(가상 "업로드 문서" 그룹 없음).
 * t(`useTranslations("shared")`)를 넘기면 문서 처리 실패 사유를 지금 언어로 쓴다.
 */
export function projectsFromServerTree(items: ServerTreeItem[], previous: Project[] = [], t?: SharedTranslate): Project[] {
  const mapItem = (item: ServerTreeItem): TreeItem => {
    const doc = item.document;
    return item.type === "folder"
      ? { id: item.id, label: item.name, type: "folder", currentVersion: item.current_version, permission: item.permission, children: (item.children ?? []).map(mapItem).sort(byName) }
      : { id: `document-file-${item.id}`, label: item.name, type: "file", documentId: item.id, graphNodeId: makeRawId(item.id),
          currentVersion: item.current_version, status: doc?.status, mimeType: doc?.mime_type,
          processingState: doc?.processing_state, processingStage: doc?.processing_stage,
          errorMessage: describeDocumentFailure(doc?.error_message, doc?.error_code, t), sourceUri: doc?.source_uri, byteSize: doc?.byte_size,
          uploadedAt: doc?.uploaded_at, updatedAt: doc?.updated_at,
          canEdit: doc?.can_edit, titleLocked: isDocumentBodyLocked(doc), canDelete: doc?.can_delete, canConvert: doc?.can_convert, permission: doc?.permission };
  };
  const projects: Project[] = [
    { id: ROOT_DOCUMENTS_PROJECT_ID, folderId: null, title: ROOT_DOCUMENTS_TITLE, items: items.map(mapItem).sort(byName) }
  ];
  const serverIds = new Set<string>();
  const collect = (nodes: ServerTreeItem[]) => nodes.forEach((node) => { serverIds.add(node.id); collect(node.children ?? []); });
  collect(items);
  const retainUploads = (next: TreeItem[], old: TreeItem[]): TreeItem[] => [
    ...next.map((item) => item.children ? { ...item, children: retainUploads(item.children, old.find((oldItem) => oldItem.id === item.id)?.children ?? []) } : item),
    ...old.filter((item) => item.id.startsWith("upload-") && (!item.documentId || !serverIds.has(item.documentId)))
  ].sort(byName);
  return projects.map((project) => ({ ...project, items: retainUploads(project.items, previous.find((old) => old.id === project.id)?.items ?? []) }));
}
