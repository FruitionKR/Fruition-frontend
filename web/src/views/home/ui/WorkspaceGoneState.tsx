"use client";

import { ArrowRightLeft, LockKeyhole } from "lucide-react";
import { clearSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import styles from "./WorkspaceGoneState.module.css";

/** 다른 워크스페이스로 옮긴다. 선택을 지우면 워크스페이스 준비 화면이 접근할 수 있는 워크스페이스를 고른다. */
function moveToAnotherWorkspace() {
  clearSelectedWorkspaceId();
  window.location.assign("/workspaces");
}

/**
 * 열어 둔 워크스페이스에 더 이상 접근할 수 없을 때(멤버에서 내보내짐·워크스페이스 삭제, 404 WORKSPACE_NOT_FOUND).
 * 지난 트리·문서를 지우고 이 안내만 남긴다.
 */
export function WorkspaceGoneState() {
  return (
    <main className={styles.screen}>
      <section className={styles.card} aria-labelledby="workspace-gone-title">
        <div className={styles.icon} aria-hidden>
          <LockKeyhole size={26} strokeWidth={1.8} />
        </div>
        <h1 id="workspace-gone-title">이 워크스페이스에 더 이상 접근할 수 없어요</h1>
        <p className={styles.description}>
          워크스페이스에서 내보내졌거나 워크스페이스가 삭제되었을 수 있어요.
          다른 워크스페이스로 이동해 계속 작업해 주세요.
        </p>
        <button type="button" className={styles.action} onClick={moveToAnotherWorkspace} autoFocus>
          <ArrowRightLeft size={16} aria-hidden />
          다른 워크스페이스로 이동
        </button>
      </section>
    </main>
  );
}
