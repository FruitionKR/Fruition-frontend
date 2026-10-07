"use client";

import { useState } from "react";
import { MarkdownViewer } from "@/shared/ui/MarkdownViewer";
import { ConfirmModal } from "@/shared/ui/ConfirmModal";
import { getErrorMessage } from "@/shared/lib/errors";
import { splitEditableNoteMarkdown, stripPageComments } from "@/entities/document/lib/note";
import { restoreDocumentVersion } from "../api/versions";
import styles from "./VersionPreview.module.css";

/** 읽기 전용으로 여는 과거 버전. baseVersion은 열람을 시작할 때의 현재 버전(복원 base_version)이다. */
export type ViewedDocumentVersion = {
  documentId: string;
  version: number;
  markdown: string;
  baseVersion: number;
};

/**
 * 과거 버전 본문을 편집기 대신 읽기 전용으로 보여 준다.
 * 편집기를 띄우지 않으므로 입력·붙여넣기·AI 적용·자동 저장(PUT content)이 일어나지 않는다.
 * 복원은 비파괴(새 버전 추가)라 배너의 2차 액션으로 두고 확인을 거친다.
 */
export function VersionPreview({
  viewed,
  onExit,
  onRestored
}: {
  viewed: ViewedDocumentVersion;
  onExit: () => void;
  /** 복원 성공 후 호출된다. 호출 측은 문서 본문과 버전 목록을 다시 불러와야 한다. */
  onRestored: (restoredDocumentId: string) => void;
}) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const body = stripPageComments(splitEditableNoteMarkdown(viewed.markdown)?.body ?? viewed.markdown);

  async function handleRestore() {
    setIsConfirmOpen(false);
    if (isRestoring) return;
    setIsRestoring(true);
    setErrorMessage(null);
    try {
      await restoreDocumentVersion(viewed.documentId, viewed.version, viewed.baseVersion);
      onRestored(viewed.documentId);
    } catch (error) {
      // 409(다른 저장이 먼저 반영)도 서버 문구를 그대로 보여 준다. 목록을 다시 열어 최신 버전과 비교하게 한다.
      setErrorMessage(getErrorMessage(error, "버전 복원에 실패했습니다."));
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <>
      <div className={styles["version-preview-banner"]} role="status">
        <span className={styles["version-preview-label"]}>
          <strong>v{viewed.version}</strong> 버전을 보는 중(읽기 전용)
        </span>
        <div className={styles["version-preview-actions"]}>
          <button
            type="button"
            className={styles["version-preview-restore"]}
            disabled={isRestoring}
            onClick={() => setIsConfirmOpen(true)}
          >
            {isRestoring ? "복원 중…" : "이 버전으로 복원"}
          </button>
          <button type="button" className={styles["version-preview-exit"]} onClick={onExit}>
            현재 문서로 돌아가기
          </button>
        </div>
      </div>
      {errorMessage && <p className={styles["version-preview-error"]} role="alert">{errorMessage}</p>}
      <MarkdownViewer markdown={body} />
      {isConfirmOpen && (
        <ConfirmModal
          titleId="version-restore-confirm-title"
          title={`v${viewed.version} 버전으로 복원할까요?`}
          description="이 버전의 본문을 새 버전으로 저장합니다. 현재 문서와 이전 기록은 그대로 남습니다."
          confirmLabel="복원"
          onConfirm={() => void handleRestore()}
          onCancel={() => setIsConfirmOpen(false)}
        />
      )}
    </>
  );
}
