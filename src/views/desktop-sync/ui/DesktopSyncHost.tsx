"use client";

import { useEffect } from "react";
import { getDesktopApi } from "@/features/desktop-sync/bridge/desktopBridge";
import { runWorkspaceSync } from "@/features/desktop-sync/model/runWorkspaceSync";
import { createSyncScheduler } from "@/features/desktop-sync/model/syncScheduler";

/**
 * 맥 데스크톱 앱의 숨은 동기화 창(/desktop/sync)이 여는 화면. 아무것도 그리지 않고 동기화만 돌린다.
 * 사용자가 보는 화면은 워크스페이스 전환·로그인 때 통째로 다시 로드되므로 동기화를 이 창으로 분리했다.
 * 웹 브라우저에서는 데스크톱 API가 없어 아무것도 하지 않는다.
 */
export default function DesktopSyncHost() {
  useEffect(() => {
    const desktop = getDesktopApi();
    if (!desktop) return;
    const scheduler = createSyncScheduler({ desktop, runWorkspace: (workspaceId) => runWorkspaceSync(desktop, workspaceId) });
    scheduler.start();
    return () => scheduler.stop();
  }, []);
  return null;
}
