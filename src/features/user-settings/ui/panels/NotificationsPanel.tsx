import { useNotificationToggles, type NotificationKey } from "../../model/useNotificationToggles";
import { Switch } from "@/shared/ui/Switch";
import styles from "../SettingsModal.module.css";
import { PanelTitle } from "./PanelTitle";
import { SectionHeader } from "./SectionHeader";

/** 알림 항목 정의 (Figma 963:8257). */
const NOTIFICATION_ROWS: { key: NotificationKey; label: string; description: string }[] = [
  { key: "completed", label: "위키 편입 완료", description: "위키 편입이 끝나면 알림 카드를 표시합니다." },
  { key: "failed", label: "위키 편입 실패", description: "위키 편입에 실패하면 알림 카드를 표시합니다." },
  { key: "lint", label: "위키 다듬기", description: "위키 다듬기(lint) 작업이 끝나면 알립니다." },
  { key: "restore", label: "복구(롤백)", description: "AI 작업 되돌리기가 끝나면 알립니다." },
  { key: "suggest", label: "작업 제안", description: "위키 편입이나 Lint가 필요한 문서가 있으면 실행을 제안합니다." },
  { key: "query", label: "질의 완료", description: "채팅 질의의 답변 도착•실패를 알립니다." },
  { key: "browser", label: "브라우저 알림", description: "탭이 백그라운드일 때 브라우저 알림으로도 보냅니다." }
];

/** 알림 설정 패널 (Figma 963:8257). 알림 설정은 이 패널에서만 바꾼다. */
export function NotificationsPanel() {
  const { checkedValues, browserMessage, toggleNotification } = useNotificationToggles();

  return (
    <div className={styles.detail}>
      <PanelTitle title="알림" description="워크스페이스의 알림 권한을 관리합니다.">
        {/* Discord와 동일하게 알림 출력 설정은 기기(브라우저)별로 저장된다. 계정 동기화는 서버 저장 API가 필요하다. */}
        <p className={styles["title-note"]}>알림 설정은 이 기기에만 저장됩니다.</p>
      </PanelTitle>

      <div className={styles.section}>
        <SectionHeader>알림 설정</SectionHeader>
        {NOTIFICATION_ROWS.map(({ key, label, description }) => (
          <div key={key} className={styles.row}>
            <div className={styles["row-title"]}>
              <strong>{label}</strong>
              <small>{description}</small>
              {key === "browser" && browserMessage && (
                <small className={styles["row-error"]} role="alert">{browserMessage}</small>
              )}
            </div>
            <Switch checked={checkedValues[key]} label={label} onClick={() => void toggleNotification(key)} />
          </div>
        ))}
      </div>
    </div>
  );
}
