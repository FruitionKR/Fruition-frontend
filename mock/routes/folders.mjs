// document-svc(8080) 폴더 라우트: 문서 트리, 폴더 생성·이름 변경·삭제·이동, 문서 이동.
// 실제 백엔드처럼 base_version 낙관적 잠금을 검사하고 변경마다 current_version을 올린다.
import { state, now, id, error, requireWorkspace, findDocument, toDocumentItem } from "../state.mjs";

function liveFolders(workspaceId) {
  return state.folders.filter((folder) => folder.workspace_id === workspaceId && !folder.deleted_at);
}

function liveDocuments(workspaceId) {
  return state.documents.filter((doc) => doc.workspace_id === workspaceId && !doc.deleted_at);
}

function findFolder(workspaceId, folderId) {
  return liveFolders(workspaceId).find((folder) => folder.id === folderId) ?? null;
}

const bySortThenName = (a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, "ko");

/** 폴더·문서를 parent 기준으로 중첩한 트리 응답. */
function buildTree(workspaceId, parentId = null) {
  const folders = liveFolders(workspaceId)
    .filter((folder) => folder.parent_folder_id === parentId)
    .map((folder) => ({ type: "folder", id: folder.id, name: folder.name, sort_order: folder.sort_order, current_version: folder.current_version, children: buildTree(workspaceId, folder.id) }));
  const documents = liveDocuments(workspaceId)
    .filter((doc) => (doc.folder_id ?? null) === parentId)
    .map((doc) => ({ type: "document", id: doc.id, name: doc.filename, sort_order: doc.sort_order ?? 0, current_version: doc.current_version, document: toDocumentItem(doc) }));
  return [...folders, ...documents].sort(bySortThenName);
}

function isDescendant(workspaceId, folderId, ancestorId) {
  let current = findFolder(workspaceId, folderId);
  while (current) {
    if (current.id === ancestorId) return true;
    current = current.parent_folder_id ? findFolder(workspaceId, current.parent_folder_id) : null;
  }
  return false;
}

function nextSortOrder(workspaceId, parentId) {
  const siblings = [
    ...liveFolders(workspaceId).filter((folder) => folder.parent_folder_id === parentId),
    ...liveDocuments(workspaceId).filter((doc) => (doc.folder_id ?? null) === parentId)
  ];
  return siblings.reduce((max, item) => Math.max(max, item.sort_order ?? 0), -1) + 1;
}

function requireFolder(ctx, workspace) {
  const folder = findFolder(workspace.id, ctx.params.id);
  if (!folder) error(ctx, 404, "폴더를 찾을 수 없습니다.");
  return folder;
}

function requireParent(ctx, workspace, parentId) {
  if (parentId === null || parentId === undefined) return true;
  if (!findFolder(workspace.id, parentId)) { error(ctx, 404, "상위 폴더를 찾을 수 없습니다."); return false; }
  return true;
}

function toFolderResponse(folder) {
  return { id: folder.id, name: folder.name, parent_folder_id: folder.parent_folder_id, current_version: folder.current_version, sort_order: folder.sort_order };
}

function deleteFolderTree(workspaceId, folderId, timestamp) {
  for (const child of liveFolders(workspaceId).filter((folder) => folder.parent_folder_id === folderId)) deleteFolderTree(workspaceId, child.id, timestamp);
  for (const doc of liveDocuments(workspaceId).filter((item) => item.folder_id === folderId)) doc.deleted_at = timestamp;
  const folder = findFolder(workspaceId, folderId);
  if (folder) folder.deleted_at = timestamp;
}

export function registerFolderRoutes(router) {
  router.get("/api/workspaces/:wid/document-tree", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    ctx.json(200, { items: buildTree(workspace.id) });
  });

  router.post("/api/workspaces/:wid/folders", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { name, parent_folder_id: parentId = null } = await ctx.body();
    if (typeof name !== "string" || !name.trim()) return error(ctx, 400, "폴더 이름을 입력해주세요.");
    if (!requireParent(ctx, workspace, parentId)) return;
    const folder = { id: id("folder"), workspace_id: workspace.id, name: name.trim(), parent_folder_id: parentId, sort_order: nextSortOrder(workspace.id, parentId), current_version: 1, created_at: now() };
    state.folders.push(folder);
    ctx.json(201, toFolderResponse(folder));
  });

  router.patch("/api/workspaces/:wid/folders/:id", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const folder = requireFolder(ctx, workspace);
    if (!folder) return;
    const { name, base_version } = await ctx.body();
    if (base_version !== folder.current_version) return error(ctx, 409, "폴더가 다른 곳에서 변경되었습니다. 새로고침 후 다시 시도해주세요.");
    if (typeof name !== "string" || !name.trim()) return error(ctx, 400, "폴더 이름을 입력해주세요.");
    folder.name = name.trim();
    folder.current_version += 1;
    ctx.json(200, toFolderResponse(folder));
  });

  router.delete("/api/workspaces/:wid/folders/:id", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const folder = requireFolder(ctx, workspace);
    if (!folder) return;
    const { base_version } = await ctx.body();
    if (base_version !== folder.current_version) return error(ctx, 409, "폴더가 다른 곳에서 변경되었습니다. 새로고침 후 다시 시도해주세요.");
    deleteFolderTree(workspace.id, folder.id, now());
    ctx.json(204);
  });

  router.patch("/api/workspaces/:wid/folders/:id/position", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const folder = requireFolder(ctx, workspace);
    if (!folder) return;
    const { parent_folder_id: parentId = null, position, base_version } = await ctx.body();
    if (base_version !== folder.current_version) return error(ctx, 409, "폴더가 다른 곳에서 변경되었습니다. 새로고침 후 다시 시도해주세요.");
    if (!requireParent(ctx, workspace, parentId)) return;
    if (parentId !== null && (parentId === folder.id || isDescendant(workspace.id, parentId, folder.id))) return error(ctx, 400, "폴더를 자기 자신이나 하위 폴더로 옮길 수 없습니다.");
    folder.parent_folder_id = parentId;
    folder.sort_order = typeof position === "number" ? position : nextSortOrder(workspace.id, parentId);
    folder.current_version += 1;
    ctx.json(200, toFolderResponse(folder));
  });

  router.patch("/api/workspaces/:wid/documents/:id/position", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = findDocument(workspace.id, ctx.params.id);
    if (!doc) return error(ctx, 404, "문서를 찾을 수 없습니다.");
    const { folder_id: folderId = null, position, base_version } = await ctx.body();
    if (base_version !== doc.current_version) return error(ctx, 409, "문서가 다른 곳에서 변경되었습니다. 새로고침 후 다시 시도해주세요.");
    if (!requireParent(ctx, workspace, folderId)) return;
    doc.folder_id = folderId;
    doc.sort_order = typeof position === "number" ? position : nextSortOrder(workspace.id, folderId);
    doc.current_version += 1;
    doc.updated_at = now();
    ctx.json(200, toDocumentItem(doc));
  });
}
