import { normalizeSyncName, toServerFilename } from "@/features/desktop-sync/lib/syncNames";

/** 연결 폴더 기준 상대 경로와 내용 해시. */
export type LocalFile = { path: string; hash: string };

/** 서버 트리의 문서. path는 폴더 이름과 서버 파일명을 이은 상대 경로다. */
export type RemoteFile = {
  documentId: string;
  path: string;
  updatedAt: string;
  /** 앱이 올릴 수 없는 문서(편집 권한 없음·채팅 문서 등). 로컬 변경은 올리지 않는다. */
  readonly: boolean;
};

/** 지난번 동기화가 끝났을 때 양쪽의 상태. */
export type SyncRecord = {
  documentId: string;
  localPath: string;
  remotePath: string;
  localHash: string;
  remoteUpdatedAt: string;
};

export type SyncAction =
  /** 서버 기준으로 같은 이름이 되는 파일·문서가 여럿이라 처리하지 않는다. 사용자가 이름을 정리해야 한다. */
  | { type: "collision"; paths: string[] }
  | { type: "trash-local"; documentId: string; localPath: string }
  | { type: "delete-remote"; documentId: string }
  | { type: "forget"; documentId: string }
  | { type: "move-local"; documentId: string; fromPath: string; toPath: string }
  | { type: "move-remote"; documentId: string; localPath: string }
  | { type: "download"; documentId: string; localPath: string }
  | { type: "compare"; documentId: string; localPath: string }
  | { type: "pull"; documentId: string; localPath: string }
  | { type: "conflict"; documentId: string; localPath: string }
  /** 올릴 수 없는 문서의 로컬 변경. 실행 엔진은 로컬 변경을 사본으로 보존하고 서버 본으로 되돌린다. */
  | { type: "readonly"; documentId: string; localPath: string }
  | { type: "push"; documentId: string; localPath: string }
  /** replacesDocumentId는 서버에서 지워진 문서를 다시 올릴 때 지울 옛 기록이다. */
  | { type: "upload"; localPath: string; replacesDocumentId?: string };

/** 실행 순서. 자리를 비우고(정리) 옮긴 뒤 내려받고 마지막에 올려야 이름이 겹치지 않는다. */
const PHASE: Record<SyncAction["type"], number> = {
  collision: 0,
  "trash-local": 1, "delete-remote": 1, forget: 1,
  "move-local": 2, "move-remote": 2,
  download: 3, compare: 3, pull: 3, conflict: 3, readonly: 3,
  push: 4,
  upload: 5
};

type PlanInput = { records: SyncRecord[]; local: LocalFile[]; remote: RemoteFile[] };

/**
 * 지난 동기화 기록과 현재 로컬·서버 상태를 비교해 할 일을 정한다(3-way 비교).
 * 파일을 읽거나 요청을 보내지 않는 순수 함수이며, 결과는 실행 순서대로 정렬돼 있다.
 * 기존 로컬 파일을 덮어쓰게 되는 경우와 이동이 모호한 경우는 데이터를 지키기 위해 충돌·삭제+업로드로 둔다.
 */
export function planSync(input: PlanInput): SyncAction[] {
  const actions: SyncAction[] = [];
  const usedLocal = new Set<string>();
  const localByKey = indexLocal(input, actions, usedLocal);
  const occupiedKeys = new Set(input.local.map((file) => pathKey(file.path)));
  const recordedIds = new Set(input.records.map((record) => record.documentId));
  const recordedLocalKeys = new Set(input.records.map((record) => pathKey(record.localPath)));
  const remoteById = new Map(input.remote.map((file) => [file.documentId, file]));
  const unrecordedRemote = groupBy(input.remote.filter((file) => !recordedIds.has(file.documentId)), (file) => pathKey(file.path));

  const claimedKeys = new Set<string>();
  /** 비어 있고 다른 동작이 쓰지 않는 자리에만 쓴다. 아니면 덮어쓰지 않고 충돌로 둔다. */
  const writeTo = (path: string, action: SyncAction) => {
    const key = pathKey(path);
    if (occupiedKeys.has(key) || claimedKeys.has(key)) actions.push({ type: "collision", paths: [path] });
    else {
      claimedKeys.add(key);
      actions.push(action);
    }
  };

  // 사라진 기록의 파일이 다른 경로에 같은 내용으로 나타났는지(이동). 후보가 하나일 때만 이동으로 본다.
  const missingHashCount = countBy(
    input.records.filter((record) => !localByKey.has(pathKey(record.localPath))),
    (record) => record.localHash
  );
  const findMoved = (record: SyncRecord) => {
    if (missingHashCount.get(record.localHash) !== 1) return undefined;
    const candidates = input.local.filter((file) => {
      const key = pathKey(file.path);
      return file.hash === record.localHash && !usedLocal.has(file.path)
        && !recordedLocalKeys.has(key) && !unrecordedRemote.has(key);
    });
    return candidates.length === 1 ? candidates[0] : undefined;
  };

  for (const record of input.records) {
    const remote = remoteById.get(record.documentId);
    const local = localByKey.get(pathKey(record.localPath));
    if (local) usedLocal.add(local.path);
    const remoteChanged = remote !== undefined && remote.updatedAt !== record.remoteUpdatedAt;
    const remoteRenamed = remote !== undefined && pathKey(remote.path) !== pathKey(record.remotePath);

    if (!local) {
      if (!remote) {
        actions.push({ type: "forget", documentId: record.documentId });
        continue;
      }
      const moved = findMoved(record);
      if (moved) usedLocal.add(moved.path);
      if (remote.readonly) {
        // 읽기 전용 문서는 로컬 삭제·이동을 서버에 반영하지 않고 원래 자리에 되돌린다. 옮긴 사본은 올리지 않는다.
        const localPath = toLocalPath(remote.path, record.localPath);
        writeTo(localPath, { type: "download", documentId: record.documentId, localPath });
        if (moved) actions.push({ type: "readonly", documentId: record.documentId, localPath: moved.path });
      } else if (moved && !remoteChanged && !remoteRenamed) {
        actions.push({ type: "move-remote", documentId: record.documentId, localPath: moved.path });
      } else if (moved) {
        // 서버도 바뀌었으면 이동으로 합치지 않고 로컬 사본은 새 파일로 올린다.
        usedLocal.delete(moved.path);
        const localPath = toLocalPath(remote.path, record.localPath);
        writeTo(localPath, { type: "download", documentId: record.documentId, localPath });
      } else if (remoteChanged || remoteRenamed) {
        const localPath = toLocalPath(remote.path, record.localPath);
        writeTo(localPath, { type: "download", documentId: record.documentId, localPath });
      } else {
        actions.push({ type: "delete-remote", documentId: record.documentId });
      }
      continue;
    }

    const localChanged = local.hash !== record.localHash;
    if (!remote) {
      actions.push(localChanged
        ? { type: "upload", localPath: local.path, replacesDocumentId: record.documentId }
        : { type: "trash-local", documentId: record.documentId, localPath: local.path });
      continue;
    }

    let localPath = local.path;
    if (remoteRenamed) {
      const toPath = toLocalPath(remote.path, record.localPath);
      const before = actions.length;
      writeTo(toPath, { type: "move-local", documentId: record.documentId, fromPath: local.path, toPath });
      if (actions[before]?.type === "collision") continue;
      localPath = toPath;
    }
    if (localChanged && remote.readonly) actions.push({ type: "readonly", documentId: record.documentId, localPath });
    else if (localChanged && remoteChanged) actions.push({ type: "conflict", documentId: record.documentId, localPath });
    else if (localChanged) actions.push({ type: "push", documentId: record.documentId, localPath });
    else if (remoteChanged) actions.push({ type: "pull", documentId: record.documentId, localPath });
  }

  for (const [key, remotes] of unrecordedRemote) {
    if (remotes.length > 1) {
      actions.push({ type: "collision", paths: remotes.map((file) => file.path) });
      continue;
    }
    const remote = remotes[0];
    const local = localByKey.get(key);
    if (local && !usedLocal.has(local.path)) {
      usedLocal.add(local.path);
      claimedKeys.add(key);
      actions.push({ type: "compare", documentId: remote.documentId, localPath: local.path });
    } else {
      writeTo(remote.path, { type: "download", documentId: remote.documentId, localPath: remote.path });
    }
  }

  for (const local of input.local) {
    if (!usedLocal.has(local.path)) actions.push({ type: "upload", localPath: local.path });
  }
  return actions
    .map((action, order) => ({ action, order }))
    .sort((a, b) => PHASE[a.action.type] - PHASE[b.action.type] || a.order - b.order)
    .map(({ action }) => action);
}

/**
 * 로컬 파일을 서버 기준 경로 키로 묶는다. 같은 키가 여럿이면(a.txt와 a.md, 대소문자·NFD 차이)
 * 기록된 경로와 정확히 같은 파일만 남기고 나머지는 충돌로 알린다.
 */
function indexLocal(input: PlanInput, actions: SyncAction[], usedLocal: Set<string>): Map<string, LocalFile> {
  const recordedPaths = new Set(input.records.map((record) => record.localPath.normalize("NFC")));
  const localByKey = new Map<string, LocalFile>();
  for (const [key, files] of groupBy(input.local, (file) => pathKey(file.path))) {
    const owner = files.length === 1 ? files[0] : files.find((file) => recordedPaths.has(file.path.normalize("NFC")));
    if (owner) localByKey.set(key, owner);
    const others = files.filter((file) => file !== owner);
    if (others.length === 0) continue;
    others.forEach((file) => usedLocal.add(file.path));
    actions.push({ type: "collision", paths: others.map((file) => file.path) });
  }
  return localByKey;
}

/** 서버 기준(NFC·대소문자 무시, .txt는 .md)으로 경로를 비교하기 위한 키. */
function pathKey(path: string): string {
  const segments = path.split("/");
  const filename = toServerFilename(segments.pop() ?? "");
  return [...segments.map(normalizeSyncName), filename].join("/").toLowerCase();
}

/** 서버 경로를 로컬 경로로 바꾼다. 로컬이 .txt였으면 서버의 .md 대신 원래 확장자를 유지한다. */
function toLocalPath(remotePath: string, previousLocalPath: string): string {
  const localExtension = previousLocalPath.match(/\.txt$/i)?.[0];
  return localExtension ? remotePath.replace(/\.md$/i, localExtension) : remotePath;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return groups;
}

function countBy<T>(items: T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  return counts;
}
