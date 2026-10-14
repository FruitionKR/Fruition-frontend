import { hasPdfExtension } from "@/entities/document/lib/documentKind";
import { classifySyncError } from "@/features/desktop-sync/lib/syncErrors";
import { isSameContent, toLocalContent, toServerContent } from "@/features/desktop-sync/lib/syncContent";
import { isSameSyncName, normalizeSyncName, toServerFilename } from "@/features/desktop-sync/lib/syncNames";
import type { SyncAction } from "@/features/desktop-sync/model/planSync";
import type { RemoteTreeIndex } from "@/features/desktop-sync/model/remoteTree";
import type { EngineRecord, SyncDeps, SyncEvent, SyncState } from "@/features/desktop-sync/model/syncEngine";

export type ActionContext = {
  deps: SyncDeps;
  index: RemoteTreeIndex;
  events: SyncEvent[];
  /** 이번 주기에 읽은 로컬 파일 해시. 로컬 이동을 하면 함께 옮긴다. */
  localHashes: Map<string, string>;
  /** 이번 주기에 만든 폴더. 키는 폴더 경로의 정규화 키다. */
  folderIds: Map<string, string>;
  getState(): SyncState;
  setState(next: SyncState): Promise<void>;
  now(): number;
};

/** 계획의 동작 하나를 실행한다. 실패는 던지고 엔진이 분류한다(버전 충돌만 여기서 충돌로 처리). */
export async function runAction(action: SyncAction, context: ActionContext): Promise<void> {
  switch (action.type) {
    case "collision":
      context.events.push({ kind: "collision", paths: action.paths });
      return;
    case "forget":
      return removeRecord(context, action.documentId);
    case "trash-local":
      await context.deps.local.trash(action.localPath);
      return removeRecord(context, action.documentId);
    case "delete-remote":
      return deleteRemote(context, action.documentId);
    case "move-local":
      return moveLocal(context, action.documentId, action.fromPath, action.toPath);
    case "move-remote":
      return moveRemote(context, action.documentId, action.localPath);
    case "upload":
      return upload(context, action.localPath, action.replacesDocumentId);
    case "download":
    case "pull":
    case "compare":
      return syncDown(context, action.documentId, action.localPath, action.type);
    case "conflict":
      return keepLocalAside(context, action.documentId, action.localPath, "conflict");
    case "readonly":
      return keepLocalAside(context, action.documentId, action.localPath, "readonly");
    case "push":
      return push(context, action.documentId, action.localPath);
  }
}

/** 재전송 키. 보내기 전에 상태에 저장해 두고, 성공하면 지운다. */
async function keyFor(context: ActionContext, name: string): Promise<string> {
  const state = context.getState();
  const existing = state.pendingKeys[name];
  if (existing) return existing.key;
  const key = context.deps.newKey();
  await context.setState({ ...state, pendingKeys: { ...state.pendingKeys, [name]: { key, createdAt: context.now() } } });
  return key;
}

async function clearKey(context: ActionContext, name: string): Promise<void> {
  const state = context.getState();
  const pendingKeys = Object.fromEntries(Object.entries(state.pendingKeys).filter(([keyName]) => keyName !== name));
  await context.setState({ ...state, pendingKeys });
}

async function upsertRecord(context: ActionContext, record: EngineRecord, replacesDocumentId?: string): Promise<void> {
  const state = context.getState();
  const others = state.records.filter((item) => item.documentId !== record.documentId && item.documentId !== replacesDocumentId);
  await context.setState({ ...state, records: [...others, record] });
}

async function removeRecord(context: ActionContext, documentId: string): Promise<void> {
  const state = context.getState();
  await context.setState({ ...state, records: state.records.filter((item) => item.documentId !== documentId) });
}

function requireRecord(context: ActionContext, documentId: string): EngineRecord {
  const record = context.getState().records.find((item) => item.documentId === documentId);
  if (!record) throw new Error(`동기화 기록이 없는 문서입니다: ${documentId}`);
  return record;
}

function remoteFile(context: ActionContext, documentId: string) {
  const remote = context.index.files.find((file) => file.documentId === documentId);
  if (!remote) throw new Error(`서버 트리에 없는 문서입니다: ${documentId}`);
  return remote;
}

function treeDocument(context: ActionContext, documentId: string) {
  const document = context.index.documents.get(documentId);
  if (!document) throw new Error(`서버 트리에 없는 문서입니다: ${documentId}`);
  return document;
}

async function deleteRemote(context: ActionContext, documentId: string): Promise<void> {
  const { api, workspaceId } = context.deps;
  const keyName = `delete:${documentId}`;
  await api.deleteSyncDocument(workspaceId, documentId, treeDocument(context, documentId).currentVersion, await keyFor(context, keyName));
  await clearKey(context, keyName);
  await removeRecord(context, documentId);
}

async function moveLocal(context: ActionContext, documentId: string, fromPath: string, toPath: string): Promise<void> {
  await context.deps.local.move(fromPath, toPath);
  // 같은 주기의 다음 동작(push·pull)이 옮긴 경로로 해시를 찾는다.
  const hash = context.localHashes.get(fromPath);
  context.localHashes.delete(fromPath);
  if (hash !== undefined) context.localHashes.set(toPath, hash);
  await upsertRecord(context, { ...requireRecord(context, documentId), localPath: toPath, remotePath: remoteFile(context, documentId).path });
}

/** 로컬에서 옮기거나 이름을 바꾼 파일을 서버에서도 옮기고 이름을 바꾼다. 확장자가 바뀌면 다시 올린다. */
async function moveRemote(context: ActionContext, documentId: string, localPath: string): Promise<void> {
  const { api, workspaceId } = context.deps;
  const document = treeDocument(context, documentId);
  const serverName = toServerFilename(baseName(localPath));
  if (extensionOf(serverName) !== extensionOf(document.filename)) {
    await deleteRemote(context, documentId);
    return upload(context, localPath);
  }
  const folder = dirName(localPath);
  const folderId = await ensureFolder(context, folder);
  if (folderId !== document.folderId) {
    const keyName = `move:${documentId}:${folderId ?? "root"}`;
    await api.moveSyncDocument(workspaceId, documentId, folderId, document.currentVersion, await keyFor(context, keyName));
    await clearKey(context, keyName);
    // 이름 변경이 실패해도 다음 주기가 이동을 다시 하지 않도록 옮긴 위치를 먼저 남긴다.
    await upsertRecord(context, { ...requireRecord(context, documentId), remotePath: joinPath(folder, document.filename) });
  }
  if (!isSameSyncName(serverName, document.filename)) {
    // 이동하면 버전이 오르므로 이름 변경 직전의 버전을 다시 읽는다.
    const detail = await api.fetchSyncDocument(workspaceId, documentId);
    await api.renameSyncDocument(workspaceId, documentId, serverName.slice(0, -extensionOf(serverName).length), detail.currentVersion);
  }
  await upsertRecord(context, { ...requireRecord(context, documentId), localPath, remotePath: joinPath(folder, serverName) });
}

async function upload(context: ActionContext, localPath: string, replacesDocumentId?: string): Promise<void> {
  const { api, local, workspaceId } = context.deps;
  const { file, hash } = await local.readFile(localPath);
  const folderId = await ensureFolder(context, dirName(localPath));
  const keyName = `upload:${localPath}:${hash}`;
  const uploaded = await api.uploadSyncFile(workspaceId, file, folderId, await keyFor(context, keyName));
  await clearKey(context, keyName);
  const detail = await api.fetchSyncDocument(workspaceId, uploaded.id);
  await upsertRecord(context, {
    documentId: uploaded.id,
    localPath,
    remotePath: joinPath(dirName(localPath), uploaded.filename),
    localHash: hash,
    remoteUpdatedAt: detail.updatedAt,
    marker: detail.markdown ? toLocalContent(detail.markdown).marker : null,
    editRevision: detail.documentRole === "EDITABLE" && detail.markdown !== null ? detail.editRevision : null
  }, replacesDocumentId);
}

type DownMode = "download" | "pull" | "compare" | "restore";

/**
 * 서버 내용을 로컬에 쓴다.
 * - pull·compare: 내용이 같으면 쓰지 않는다. compare에서 다르면 로컬을 사본으로 보존한다.
 * - pull·download: 계획을 세운 뒤 로컬 파일이 바뀌었거나 생겼으면 덮기 전에 사본으로 보존한다.
 * - restore: 호출부가 이미 보존한 뒤 서버 본으로 되돌린다.
 */
async function syncDown(context: ActionContext, documentId: string, localPath: string, mode: DownMode): Promise<void> {
  const { api, local, workspaceId } = context.deps;
  const remote = remoteFile(context, documentId);
  const base = { documentId, localPath, remotePath: remote.path, remoteUpdatedAt: remote.updatedAt };

  if (hasPdfExtension(remote.path)) {
    const blob = await api.fetchSyncOriginal(workspaceId, documentId);
    const current = mode === "pull" || mode === "compare" ? await local.readFile(localPath) : null;
    if (current && await isSameBlob(current.file, blob)) {
      return upsertRecord(context, { ...base, localHash: current.hash, marker: null, editRevision: null });
    }
    if (current && (mode === "compare" || current.hash !== context.localHashes.get(localPath))) {
      await setAside(context, localPath, current.file);
    } else if (mode === "download") {
      await asideIfCreated(context, localPath, async () => (await local.readFile(localPath)).file);
    }
    return upsertRecord(context, { ...base, localHash: await local.writeBlob(localPath, blob), marker: null, editRevision: null });
  }

  const detail = await api.fetchSyncDocument(workspaceId, documentId);
  if (detail.markdown === null) {
    // 변환 중이거나 본문이 아직 없다. 빈 파일을 만들지 않고 다음 주기에 다시 본다.
    context.events.push({ kind: "waiting", path: localPath });
    return;
  }
  const { marker, body } = toLocalContent(detail.markdown);
  const remoteState = { ...base, marker, editRevision: detail.editRevision };
  if (mode === "pull" || mode === "compare") {
    const current = await local.readText(localPath);
    if (isSameContent(current.text, detail.markdown)) return upsertRecord(context, { ...remoteState, localHash: current.hash });
    if (mode === "compare" || current.hash !== context.localHashes.get(localPath)) await setAside(context, localPath, current.text);
  } else if (mode === "download") {
    await asideIfCreated(context, localPath, async () => (await local.readText(localPath)).text);
  }
  await upsertRecord(context, { ...remoteState, localHash: await local.writeText(localPath, body) });
}

async function setAside(context: ActionContext, localPath: string, content: string | Blob): Promise<void> {
  context.events.push({ kind: "conflict", path: localPath, asidePath: await context.deps.local.saveAside(localPath, content) });
}

/** 계획할 때 비어 있던 자리에 그사이 파일이 생겼으면 덮기 전에 보존한다. */
async function asideIfCreated(context: ActionContext, localPath: string, read: () => Promise<string | Blob>): Promise<void> {
  if (await context.deps.local.hashOf(localPath) !== null) await setAside(context, localPath, await read());
}

/**
 * 로컬 변경을 서버에 올릴 수 없을 때(충돌·읽기 전용) 로컬 내용을 사본으로 보존하고 서버 본으로 되돌린다.
 * 읽기 전용 문서를 다른 경로로 옮긴 사본이면 사본만 보존하고 그 파일은 휴지통으로 옮긴다.
 * TODO(FruitionKR/Fruition-document#76): 충돌 등록 API가 생기면 충돌을 서버에 등록해 OWNER가 고르게 한다.
 */
async function keepLocalAside(context: ActionContext, documentId: string, localPath: string, kind: "conflict" | "readonly"): Promise<void> {
  const { local } = context.deps;
  const record = context.getState().records.find((item) => item.documentId === documentId);
  const isStrayCopy = kind === "readonly" && record !== undefined && record.localPath !== localPath;
  const content = hasPdfExtension(localPath) ? (await local.readFile(localPath)).file : (await local.readText(localPath)).text;
  if (!isStrayCopy && typeof content === "string") {
    const detail = await context.deps.api.fetchSyncDocument(context.deps.workspaceId, documentId);
    if (detail.markdown !== null && isSameContent(content, detail.markdown)) return syncDown(context, documentId, localPath, "pull");
  }
  const asidePath = await local.saveAside(localPath, content);
  context.events.push(kind === "conflict"
    ? { kind: "conflict", path: localPath, asidePath }
    : { kind: "readonly", path: localPath, asidePath });
  if (isStrayCopy) return local.trash(localPath);
  return syncDown(context, documentId, localPath, "restore");
}

async function push(context: ActionContext, documentId: string, localPath: string): Promise<void> {
  const { api, local, workspaceId } = context.deps;
  if (hasPdfExtension(localPath)) {
    // 원본 파일은 교체 API가 없어 휴지통으로 보낸 뒤 다시 올린다.
    await deleteRemote(context, documentId);
    return upload(context, localPath);
  }
  let record = requireRecord(context, documentId);
  if (record.editRevision === null) {
    // 업로드 직후 본문이 준비되기 전에 기록된 문서. 버전과 마커를 다시 읽는다.
    const detail = await api.fetchSyncDocument(workspaceId, documentId);
    if (detail.markdown === null) {
      context.events.push({ kind: "waiting", path: localPath });
      return;
    }
    record = { ...record, editRevision: detail.editRevision, marker: toLocalContent(detail.markdown).marker };
  }
  const { text, hash } = await local.readText(localPath);
  const keyName = `push:${documentId}:${hash}`;
  try {
    const saved = await api.saveSyncContent(workspaceId, documentId, {
      markdown: toServerContent(text, record.marker),
      baseRevision: record.editRevision ?? 0,
      revisionWriteId: await keyFor(context, keyName)
    });
    await clearKey(context, keyName);
    await upsertRecord(context, { ...record, localPath, localHash: hash, editRevision: saved.revision, remoteUpdatedAt: saved.updatedAt });
  } catch (error) {
    if (classifySyncError(error) !== "version-conflict") throw error;
    await clearKey(context, keyName);
    await keepLocalAside(context, documentId, localPath, "conflict");
  }
}

/** 폴더 경로의 서버 폴더 id. 없으면 상위부터 차례로 만든다. 최상위는 null이다. */
async function ensureFolder(context: ActionContext, folderPath: string): Promise<string | null> {
  if (!folderPath) return null;
  const { api, workspaceId } = context.deps;
  let parentId: string | null = null;
  let path = "";
  for (const name of folderPath.split("/")) {
    path = path ? `${path}/${name}` : name;
    const key = folderKey(path);
    let id = context.folderIds.get(key) ?? findExistingFolder(context, key);
    if (!id) {
      const keyName = `folder:${key}`;
      id = (await api.createSyncFolder(workspaceId, name, parentId, await keyFor(context, keyName))).id;
      await clearKey(context, keyName);
    }
    context.folderIds.set(key, id);
    parentId = id;
  }
  return parentId;
}

function findExistingFolder(context: ActionContext, key: string): string | undefined {
  for (const [path, folder] of context.index.folders) {
    if (folderKey(path) === key) return folder.id;
  }
  return undefined;
}

function folderKey(path: string): string {
  return path.split("/").map(normalizeSyncName).join("/").toLowerCase();
}

async function isSameBlob(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  const [left, right] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  return x.every((byte, index) => byte === y[index]);
}

function dirName(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index > 0 ? filename.slice(index).toLowerCase() : "";
}
