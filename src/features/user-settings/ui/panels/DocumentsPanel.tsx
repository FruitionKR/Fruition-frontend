"use client";

import { useWorkspaceRole } from "@/entities/workspace";
import styles from "../SettingsModal.module.css";
import { EditConflictSection } from "./collab/EditConflictSection";
import { NotificationSection } from "./collab/NotificationSection";
import { TrashSection } from "./collab/TrashSection";

/** 문서 관리: 서버 알림, 편집 충돌(OWNER만), 휴지통. 공동 편집 릴리스(#139)의 화면이다. */
export function DocumentsPanel() {
  const { isOwner } = useWorkspaceRole();

  return (
    <div className={styles.detail}>
      <div className={styles.title}>
        <div className={styles["title-row"]}>
          <h2>문서 관리</h2>
        </div>
        <p>워크스페이스 문서의 알림, 편집 충돌, 휴지통을 관리합니다.</p>
      </div>

      <NotificationSection />
      {isOwner && <EditConflictSection />}
      <TrashSection />
    </div>
  );
}
