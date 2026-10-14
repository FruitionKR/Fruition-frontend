import { listConnections, type DesktopApi } from "@/features/desktop-sync/bridge/desktopBridge";
import type { SyncEvent } from "@/features/desktop-sync/model/syncEngine";

/** 자동 동기화 간격. 웹 화면의 평소 폴링(15초)과 맞춘다. */
export const AUTO_SYNC_INTERVAL_MS = 15_000;

export type SyncReport = { workspaceId: string; events: SyncEvent[]; error?: string };

export type SyncSchedulerDeps = {
  desktop: DesktopApi;
  /** 워크스페이스 하나의 동기화 주기(파일 동기화 + 위키 미러). */
  runWorkspace(workspaceId: string): Promise<SyncEvent[]>;
  onReport?(report: SyncReport): void;
  intervalMs?: number;
};

export type SyncScheduler = {
  /** 한 번 실행한다. all이면 수동 동기화 워크스페이스까지 돌린다. 이미 실행 중이면 건너뛴다. */
  tick(all: boolean): Promise<void>;
  start(): void;
  stop(): void;
};

/**
 * 연결된 워크스페이스를 동기화한다. 자동으로 둔 워크스페이스는 주기마다,
 * 수동은 메뉴 막대의 "지금 동기화" 때만 돌린다(2026-10-09 결정).
 */
export function createSyncScheduler(deps: SyncSchedulerDeps): SyncScheduler {
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const tick = async (all: boolean) => {
    if (running) return;
    running = true;
    try {
      const connections = await listConnections(deps.desktop);
      for (const connection of connections) {
        if (!all && connection.mode !== "auto") continue;
        try {
          // onReport?.() 인자 안에서 실행하면 onReport가 없을 때 동기화 자체가 돌지 않으므로 먼저 실행한다.
          const events = await deps.runWorkspace(connection.workspaceId);
          deps.onReport?.({ workspaceId: connection.workspaceId, events });
        } catch (error) {
          // 한 워크스페이스의 실패(폴더 접근 오류 등)가 다른 워크스페이스 동기화를 막지 않게 한다.
          deps.onReport?.({ workspaceId: connection.workspaceId, events: [], error: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    tick,
    start() {
      if (timer) return;
      void tick(false);
      timer = setInterval(() => void tick(false), deps.intervalMs ?? AUTO_SYNC_INTERVAL_MS);
      unsubscribe = deps.desktop.onSyncNow(() => void tick(true));
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
    }
  };
}
