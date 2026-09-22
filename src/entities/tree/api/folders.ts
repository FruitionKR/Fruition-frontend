import { apiFetch, getWorkspaceId, workspacePath, parseJsonOrThrow, throwIfNotOk } from "@/shared/api/client";
import { findServerTreeItem, type DocumentTreeResponse, type FolderResponse } from "@/entities/tree/model/serverTree";

export async function fetchDocumentTree(workspaceId = getWorkspaceId()): Promise<DocumentTreeResponse> {
  const response = await apiFetch(workspacePath(workspaceId, "document-tree"), { cache: "no-store" });
  const tree = await parseJsonOrThrow<DocumentTreeResponse>(response, "폴더 목록을 불러오지 못했습니다.");
  if (!Array.isArray(tree.items)) throw new Error("폴더 목록 응답이 올바르지 않습니다.");
  return tree;
}

export async function createFolder(name: string, parentFolderId: string | null = null): Promise<FolderResponse> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "folders"), {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ name, parent_folder_id: parentFolderId })
  });
  return parseJsonOrThrow<FolderResponse>(response, "폴더를 생성하지 못했습니다.");
}

async function mutateTreeItem(id: string, type: "folder" | "document", method: string, suffix: string[], payload: Record<string, unknown>) {
  const workspaceId = getWorkspaceId();
  const tree = await fetchDocumentTree(workspaceId);
  const item = findServerTreeItem(tree.items, id);
  if (!item || item.type !== type) throw new Error("항목이 이동되거나 삭제되었습니다. 목록을 새로고침해 주세요.");
  const response = await apiFetch(workspacePath(workspaceId, type === "folder" ? "folders" : "documents", id, ...suffix), {
    method, headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ ...payload, base_version: item.current_version })
  });
  await throwIfNotOk(response, "폴더 또는 문서를 변경하지 못했습니다.");
}

export const renameFolder = (id: string, name: string) => mutateTreeItem(id, "folder", "PATCH", [], { name });
export const deleteFolder = (id: string) => mutateTreeItem(id, "folder", "DELETE", [], {});
export const moveFolder = (id: string, parentFolderId: string | null, position?: number) =>
  mutateTreeItem(id, "folder", "PATCH", ["position"], { parent_folder_id: parentFolderId, position });
export const moveDocument = (id: string, folderId: string | null, position?: number) =>
  mutateTreeItem(id, "document", "PATCH", ["position"], { folder_id: folderId, position });
