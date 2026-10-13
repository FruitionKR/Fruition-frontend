"use client";

import { useWorkspaceRole } from "@/entities/workspace";
import styles from "../SettingsModal.module.css";
import { EditConflictSection } from "./collab/EditConflictSection";
import { TrashSection } from "./collab/TrashSection";

/** 문서 관리: 편집 충돌(OWNER만), 휴지통. 공동 편집 릴리스(#139)의 화면이다. 서버 알림은 레일 알림 화면의 워크스페이스 탭에서 본다. */
export function DocumentsPanel() {
  const { isOwner } = useWorkspaceRole();

  return (
    <div className={styles.detail}>
      <div className={styles.title}>
        <div className={styles["title-row"]}>
          <h2>문서 관리</h2>
        </div>
        <p>워크스페이스 문서의 편집 충돌과 휴지통을 관리합니다.</p>
      </div>

      {isOwner && <EditConflictSection />}
      <TrashSection />
    </div>
  );
}
