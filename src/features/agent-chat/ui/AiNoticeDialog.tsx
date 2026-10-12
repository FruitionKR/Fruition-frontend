"use client";

import { useEffect, useState } from "react";
import { acknowledgeAiNotice, AI_FIRST_USE_NOTICE_MESSAGE, hasAcknowledgedAiNotice } from "@/shared/lib/aiNotice";
import { CenteredModal } from "@/shared/ui/CenteredModal";
import styles from "./AiNoticeDialog.module.css";

const NOTICE_TITLE = "생성형 AI 이용 안내";

/**
 * 생성형 AI 사전 고지(이슈 #131). 사용자별로 첫 로그인 뒤 한 번만 보이고, 확인 버튼으로만 닫힌다.
 * 서버 렌더와 어긋나지 않게 마운트 뒤 localStorage를 읽어 아직 확인 전이면 연다.
 */
export function AiNoticeDialog({ userId }: { userId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    if (!hasAcknowledgedAiNotice(window.localStorage, userId)) setIsOpen(true);
  }, [userId]);

  if (!isOpen) return null;

  function confirm() {
    // 저장이 실패해도(사생활 모드) 이번 세션에서는 닫는다. 다음 로그인에 다시 보일 뿐이다.
    acknowledgeAiNotice(window.localStorage, userId);
    setIsOpen(false);
  }

  return (
    // Escape·배경 클릭으로는 닫히지 않는다. 고지는 확인 버튼으로만 넘어간다.
    <CenteredModal ariaLabel={NOTICE_TITLE} className={styles.dialog} onClose={() => {}}>
      <h2 className={styles.title}>{NOTICE_TITLE}</h2>
      <p className={styles.body}>{AI_FIRST_USE_NOTICE_MESSAGE}</p>
      <button type="button" className={styles.confirm} onClick={confirm}>확인</button>
    </CenteredModal>
  );
}
