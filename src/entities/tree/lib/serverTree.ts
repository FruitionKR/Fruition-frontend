import type { Project, TreeItem } from "../model/tree";
import type { ServerTreeItem } from "../model/serverTree";
import { makeRawId } from "@/entities/graph/lib/graph";

export const ROOT_DOCUMENTS_PROJECT_ID = "project-uploaded-documents";
export const ROOT_DOCUMENTS_TITLE = "문서";
const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, "ko", { numeric: true, sensitivity: "base" });

/**
 * 서버 트리가 위치의 기준이며, 아직 완료되지 않은 업로드만 화면에 유지한다.
 * 루트 문서와 루트 폴더를 하나의 트리로 묶는다(가상 "업로드 문서" 그룹 없음).
 */
export function projectsFromServerTree(items: ServerTreeItem[], previous: Project[] = []): Project[] {
  const mapItem = (item: ServerTreeItem): TreeItem => {
    const doc = item.document;
    return item.type === "folder"
      ? { id: item.id, label: item.name, type: "folder", currentVersion: item.current_version, children: (item.children ?? []).map(mapItem).sort(byName) }
      : { id: `document-file-${item.id}`, label: item.name, type: "file", documentId: item.id, graphNodeId: makeRawId(item.id),
          currentVersion: item.current_version, status: doc?.status, mimeType: doc?.mime_type,
          processingState: doc?.processing_state, processingStage: doc?.processing_stage,
          errorMessage: doc?.error_message, sourceUri: doc?.source_uri, byteSize: doc?.byte_size,
          uploadedAt: doc?.uploaded_at, updatedAt: doc?.updated_at };
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
