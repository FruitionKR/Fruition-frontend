import { fetchDocumentTree } from "@/entities/tree/api/folders";
import * as syncApi from "@/features/desktop-sync/api/syncApi";
import { createDesktopFolderPort, createDesktopStatePort, type DesktopApi } from "@/features/desktop-sync/bridge/desktopBridge";
import { runSyncCycle, type SyncApi, type SyncEvent } from "@/features/desktop-sync/model/syncEngine";
import { runWikiMirror } from "@/features/desktop-sync/model/wikiMirror";

const api: SyncApi = {
  ...syncApi,
  fetchTree: async (workspaceId) => (await fetchDocumentTree(workspaceId, "문서 트리를 불러오지 못했습니다.")).items
};

/** 워크스페이스 하나를 동기화한다. 파일 동기화가 멈췄으면(세션 만료·네트워크) 위키 미러도 건너뛴다. */
export async function runWorkspaceSync(desktop: DesktopApi, workspaceId: string): Promise<SyncEvent[]> {
  const local = createDesktopFolderPort(desktop, workspaceId);
  const state = createDesktopStatePort(desktop, workspaceId);
  const { events } = await runSyncCycle({ workspaceId, local, state, api, newKey: () => crypto.randomUUID() });
  if (!events.some((event) => event.kind === "paused")) await runWikiMirror({ workspaceId, local, state, api });
  return events;
}
