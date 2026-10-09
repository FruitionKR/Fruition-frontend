"use client";

import { useNotificationToggles, type NotificationKey } from "@/features/user-settings";
import { Switch } from "@/shared/ui/Switch";
import styles from "./NotificationsView.module.css";

/** 알림 설정 탭 항목 (Figma 1540:21375). 작업 제안(suggest)은 시안에 없지만 설정 모달과 같은 항목을 모두 노출한다. */
const SETTING_ROWS: { key: NotificationKey; label: string; description: string }[] = [
  { key: "completed", label: "문서 처리 완료", description: "문서(Ingest) 분석이 끝나면 알림 카드를 표시합니다." },
  { key: "failed", label: "문서 처리 실패", description: "문서 처리가 실패하면 알림 카드를 표시합니다." },
  { key: "lint", label: "위키 다듬기", description: "위키 다듬기(lint) 작업이 끝나면 알립니다." },
  { key: "restore", label: "복구(롤백)", description: "AI 작업 되돌리기가 끝나면 알립니다." },
  { key: "suggest", label: "작업 제안", description: "위키 편입이나 Lint가 필요한 문서가 있으면 실행을 제안합니다." },
  { key: "query", label: "질의 완료", description: "채팅 질의의 답변 도착•실패를 알립니다." },
  { key: "browser", label: "브라우저 알림", description: "탭이 백그라운드일 때 브라우저 알림으로도 보냅니다." }
];

/** 알림 설정 탭. 설정 모달 알림 패널과 같은 토글 훅(같은 사용자 설정·같은 브라우저 권한 규칙)을 쓴다. */
export function NotificationSettings() {
  const { checkedValues, browserMessage, toggleNotification } = useNotificationToggles();

  return (
    <ul className={styles.settings}>
      {SETTING_ROWS.map(({ key, label, description }) => (
        <li key={key} className={styles["setting-row"]}>
          <div className={styles["setting-text"]}>
            <strong>{label}</strong>
            <span>{description}</span>
            {key === "browser" && browserMessage && (
              <span className={styles["setting-error"]} role="alert">{browserMessage}</span>
            )}
          </div>
          <Switch checked={checkedValues[key]} label={label} onClick={() => void toggleNotification(key)} />
        </li>
      ))}
    </ul>
  );
}
