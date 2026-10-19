"use client";

import type { DocumentItemResponse } from "@/entities/document";
import { useDocumentProcessingNotifications } from "../model/useDocumentProcessingNotifications";
import { useOperationNotifications } from "../model/useOperationNotifications";
import { usePendingWorkNotifications } from "../model/usePendingWorkNotifications";
import { useServerNotifications } from "../model/useServerNotifications";
import styles from "./DocumentProcessingNotifications.module.css";

/**
 * 우하단 알림 카드 스택 (Figma 1246:7338). 문서 처리 + AI 작업(lint·restore) + 대기 작업 감지 + 서버 앱 안 알림 + 버스 발행 알림.
 * isAboveLauncher: 채팅 패널이 닫혀 우하단 런처(48px)가 떠 있을 때만 그 위로 올린다. 패널이 열려 있으면 콘텐츠 바닥에 붙인다.
 */
export function DocumentProcessingNotifications({
  documents,
  isAboveLauncher
}: {
  documents: DocumentItemResponse[];
  isAboveLauncher: boolean;
}) {
  const { notices, dismissNotice } = useDocumentProcessingNotifications(documents);
  useOperationNotifications();
  usePendingWorkNotifications(documents);
  useServerNotifications();

  if (notices.length === 0) return null;

  return (
    <aside
      className={isAboveLauncher ? `${styles["notice-stack"]} ${styles["is-above-launcher"]}` : styles["notice-stack"]}
      aria-label="문서 처리 알림"
    >
      {notices.map((notice) => (
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
