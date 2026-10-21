"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { DocumentItemResponse } from "@/entities/document";
import { useWorkspaceRole } from "@/entities/workspace";
import { hasWorkspacePermission, type WorkspacePermission } from "@/shared/lib/workspacePermissions";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { useDocumentProcessingNotifications } from "../model/useDocumentProcessingNotifications";
import { useOperationNotifications } from "../model/useOperationNotifications";
import { selectPermissionRevokedIds } from "../model/noticeQueue";
import { usePendingWorkNotifications } from "../model/usePendingWorkNotifications";
import { useServerNotifications } from "../model/useServerNotifications";
import styles from "./DocumentProcessingNotifications.module.css";

/**
 * 우하단 알림 카드 스택 (Figma 1246:7338). 문서 처리 + AI 작업(lint·restore) + 대기 작업 감지 + 서버 앱 안 알림 + 버스 발행 알림.
 * isAboveLauncher: 채팅 패널이 닫혀 우하단 런처(48px)가 떠 있을 때만 그 위로 올린다. 패널이 열려 있으면 콘텐츠 바닥에 붙인다.
 * isOverlayOpen: 좁은 화면에서 채팅 패널·사이드바가 콘텐츠 위에 겹쳐 열려 있는지.
 *   700px 이하에서는 겹친 패널이 레일 오른쪽(채팅) 또는 화면 대부분(사이드바 300px)을 덮어 카드(320px)를 둘 자리가 없으므로
 *   그동안 스택을 숨기고 카드는 쌓아 둔다(자동 닫힘도 멈춘다). 패널을 닫으면 다시 보인다.
 *   701px 이상의 좁은 화면은 겹친 채팅 패널 왼쪽에 카드를 둘 수 있어 그대로 보인다.
 * onIngestStarted: 제안 카드로 위키 편입을 요청한 뒤 문서 목록을 다시 받는다(진행 중 상태를 바로 보고 빠른 폴링으로 바꾼다).
 * isDocumentsLoaded: 선택한 워크스페이스의 문서 목록을 받았는지. 워크스페이스를 바꾼 직후의 빈 목록을 첫 스냅샷으로 삼지 않는다.
 */
export function DocumentProcessingNotifications({
  documents,
  isAboveLauncher,
  isOverlayOpen,
  onIngestStarted,
  isDocumentsLoaded = true
}: {
  documents: DocumentItemResponse[];
  isAboveLauncher: boolean;
  isOverlayOpen: boolean;
  onIngestStarted?: () => void;
  isDocumentsLoaded?: boolean;
}) {
  const isNarrow = useIsNarrowViewport();
  const isDeferred = isOverlayOpen && isNarrow;
  const { notices, dismissNotice } = useDocumentProcessingNotifications(documents, isDeferred);
  useOperationNotifications();
  // 위키 편입·최신화 제안은 그 권한이 있는 사람에게만 띄운다(없으면 눌러도 403 WORKSPACE_PERMISSION_REQUIRED).
  const workspaceRole = useWorkspaceRole();
  usePendingWorkNotifications(documents, {
    canIngest: hasWorkspacePermission(workspaceRole, "wiki.ingest"),
    canLint: hasWorkspacePermission(workspaceRole, "wiki.lint"),
    onIngestStarted,
    workspaceId: getSelectedWorkspaceId(),
    isDocumentsLoaded
  });
  useServerNotifications();
  // 위키 편입 제안처럼 권한이 필요한 카드가 떠 있는 동안 권한이 회수되면(OWNER가 회수·403 뒤 역할 재조회) 카드를 내린다.
  const { role, permissions, isLoading: isRoleLoading } = workspaceRole;
  useEffect(() => {
    const access = { role, permissions, isLoading: isRoleLoading };
    selectPermissionRevokedIds(notices, (permission) => hasWorkspacePermission(access, permission as WorkspacePermission))
      .forEach(dismissNotice);
  }, [dismissNotice, isRoleLoading, notices, permissions, role]);

  // 자리가 없어 대기열로 뺀 카드는 앞 카드가 닫히면 보인다.
  const shownNotices = notices.filter((notice) => !notice.parked);
  if (shownNotices.length === 0 || isDeferred) return null;

  return (
    <aside
      className={isAboveLauncher ? `${styles["notice-stack"]} ${styles["is-above-launcher"]}` : styles["notice-stack"]}
      aria-label="문서 처리 알림"
    >
      {shownNotices.map((notice) => (
        <div
          key={notice.id}
          className={notice.leaving ? `${styles["notice"]} ${styles["is-leaving"]}` : styles["notice"]}
          role={notice.kind === "failed" ? "alert" : "status"}
          aria-hidden={notice.leaving || undefined}
        >
          <div className={styles["notice-title"]}>
            <strong>{notice.title}</strong>
            <p>{notice.message}</p>
          </div>
          {notice.action ? (
            <div className={styles["notice-buttons"]}>
              <button
                type="button"
                className={styles["notice-cancel"]}
                onClick={() => dismissNotice(notice.id)}
              >
                취소
              </button>
              <button
                type="button"
                className={styles["notice-confirm"]}
                onClick={() => {
                  notice.action?.onAction();
                  dismissNotice(notice.id);
                }}
              >
                {notice.action.label}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles["notice-confirm"]}
              onClick={() => dismissNotice(notice.id)}
            >
              확인
            </button>
          )}
        </div>
      ))}
    </aside>
  );
}

/** CSS의 @media (max-width: 700px)(카드를 화면 폭으로 펼치는 구간)와 같은 기준 */
const NARROW_VIEWPORT_QUERY = "(max-width: 700px)";

function subscribeNarrowViewport(onChange: () => void) {
  const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useIsNarrowViewport(): boolean {
  return useSyncExternalStore(
    subscribeNarrowViewport,
    () => window.matchMedia(NARROW_VIEWPORT_QUERY).matches,
    () => false
  );
}
