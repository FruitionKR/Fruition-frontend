import type * as SyncApiModule from "@/features/desktop-sync/api/syncApi";
import type { ServerTreeItem } from "@/entities/tree/model/serverTree";
import { classifySyncError, type SyncErrorKind } from "@/features/desktop-sync/lib/syncErrors";
import { planSync, type LocalFile, type SyncAction, type SyncRecord } from "@/features/desktop-sync/model/planSync";
import { indexRemoteTree } from "@/features/desktop-sync/model/remoteTree";
import { runAction } from "@/features/desktop-sync/model/syncActions";

/** 동기화 기록. 편집 문서는 업로드할 때 다시 붙일 첫 줄 마커와 다음 base_revision을 함께 보관한다. */
export type EngineRecord = SyncRecord & { marker: string | null; editRevision: number | null };

/** 워크스페이스별로 영속하는 동기화 상태. pendingKeys는 보내기 전에 저장해 재전송 때 같은 키를 쓴다. */
export type SyncState = {
  records: EngineRecord[];
  readonlyIds: string[];
  pendingKeys: Record<string, { key: string; createdAt: number }>;
  /** 위키 미러 상태. lastChangeAt이 서버와 같으면 다시 받지 않는다. */
  wiki?: { lastChangeAt: string | null; paths: Record<string, string> };
};

/** 연결 폴더 접근. Electron main 프로세스가 구현하고, 경로는 연결 폴더 기준 상대 경로다. */
export type LocalFolderPort = {
  /** 동기화 대상 파일과 내용 해시. */
  list(): Promise<LocalFile[]>;
  /** 읽은 내용과 그 내용의 해시(list와 같은 방식). */
  readText(path: string): Promise<{ text: string; hash: string }>;
  readFile(path: string): Promise<{ file: File; hash: string }>;
  /** 지금 파일의 해시. 파일이 없으면 null. */
  hashOf(path: string): Promise<string | null>;
  /** 쓰고 난 내용 해시를 돌려준다. */
  writeText(path: string, text: string): Promise<string>;
  writeBlob(path: string, blob: Blob): Promise<string>;
  move(from: string, to: string): Promise<void>;
  /** macOS 휴지통으로 옮긴다. */
  trash(path: string): Promise<void>;
  /** 덮어쓰기 전에 로컬 내용을 .fruition/sync/에 보존하고 보존한 경로를 돌려준다. */
  saveAside(path: string, content: string | Blob): Promise<string>;
};

export type SyncStatePort = {
  load(): Promise<SyncState>;
  save(state: SyncState): Promise<void>;
};

export type SyncApi = Pick<
  typeof SyncApiModule,
  | "fetchSyncDocument" | "fetchSyncOriginal" | "saveSyncContent" | "uploadSyncFile"
  | "createSyncFolder" | "moveSyncDocument" | "renameSyncDocument" | "deleteSyncDocument"
  | "fetchSyncWikiChangedAt" | "fetchSyncWikiGraph" | "fetchSyncWikiPage"
> & { fetchTree(workspaceId: string): Promise<ServerTreeItem[]> };

export type SyncEvent =
  | { kind: "conflict"; path: string; asidePath: string }
  | { kind: "readonly"; path: string; asidePath?: string }
  | { kind: "collision"; paths: string[] }
  | { kind: "waiting"; path: string }
  | { kind: "failed"; path: string; reason: SyncErrorKind }
  | { kind: "paused"; reason: "mass-delete" | "retry" | "session-expired" };

export type SyncDeps = {
  workspaceId: string;
  local: LocalFolderPort;
  state: SyncStatePort;
  api: SyncApi;
  newKey(): string;
  now?(): number;
};

/** 서버 삭제가 이 수 이상이고 기록의 절반을 넘으면, 폴더를 잘못 읽었을 수 있으므로 지우지 않고 멈춘다. */
const MASS_DELETE_MIN = 5;
/** 서버가 Idempotency-Key를 24시간만 기억하므로, 그보다 오래된 키는 다시 써도 소용이 없어 버린다. */
const PENDING_KEY_TTL_MS = 23 * 60 * 60 * 1000;

/** 한 번의 동기화 주기: 서버 트리와 로컬 폴더를 읽고, 계획을 세워 순서대로 실행한다. */
export async function runSyncCycle(deps: SyncDeps): Promise<{ events: SyncEvent[] }> {
  const now = deps.now ?? Date.now;
  let state = pruneKeys(await deps.state.load(), now());
  let tree: ServerTreeItem[];
  try {
    tree = await deps.api.fetchTree(deps.workspaceId);
  } catch (error) {
    return { events: [pausedFor(classifySyncError(error))] };
  }
  const local = await deps.local.list();
  // 기록이 있는데 폴더가 비어 보이면 연결 해제·권한 오류일 수 있다. 서버 문서를 지우지 않도록 아무것도 하지 않는다.
  if (local.length === 0 && state.records.length > 0) return { events: [{ kind: "paused", reason: "mass-delete" }] };

  const events: SyncEvent[] = [];
  const index = indexRemoteTree(tree, new Set(state.readonlyIds));
  let actions = planSync({ records: state.records, local, remote: index.files });
  const deletes = actions.filter((action) => action.type === "delete-remote").length;
  if (deletes >= MASS_DELETE_MIN && deletes * 2 > state.records.length) {
    events.push({ kind: "paused", reason: "mass-delete" });
    actions = actions.filter((action) => action.type !== "delete-remote");
  }

  const setState = async (next: SyncState) => {
    state = next;
    await deps.state.save(next);
  };
  const context = {
    deps,
    index,
    events,
    localHashes: new Map(local.map((file) => [file.path, file.hash])),
    folderIds: new Map<string, string>(),
    getState: () => state,
    setState,
    now
  };

  for (const action of actions) {
    try {
      await runAction(action, context);
    } catch (error) {
      const kind = classifySyncError(error);
      if (kind === "retry" || kind === "session-expired") {
        events.push(pausedFor(kind));
        break;
      }
      const documentId = "documentId" in action ? action.documentId : undefined;
      const path = actionPath(action);
      if (kind === "forbidden" && documentId) {
        await setState({ ...state, readonlyIds: [...new Set([...state.readonlyIds, documentId])] });
        events.push({ kind: "readonly", path });
      } else if (kind === "processing") {
        events.push({ kind: "waiting", path });
      } else {
        events.push({ kind: "failed", path, reason: kind });
      }
    }
  }
  return { events };
}

function pruneKeys(state: SyncState, now: number): SyncState {
  const pendingKeys = Object.fromEntries(
    Object.entries(state.pendingKeys).filter(([, pending]) => now - pending.createdAt < PENDING_KEY_TTL_MS)
  );
  return { ...state, pendingKeys };
}

function pausedFor(kind: SyncErrorKind): SyncEvent {
  return { kind: "paused", reason: kind === "session-expired" ? "session-expired" : "retry" };
}

function actionPath(action: SyncAction): string {
  if (action.type === "collision") return action.paths[0] ?? "";
  if (action.type === "move-local") return action.toPath;
  return "localPath" in action ? action.localPath : action.documentId;
}
