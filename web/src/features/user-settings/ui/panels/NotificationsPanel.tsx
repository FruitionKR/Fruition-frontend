import { useNotificationToggles, type NotificationKey } from "../../model/useNotificationToggles";
import { cx } from "@/shared/lib/classNames";
import { Switch } from "@/shared/ui/Switch";
import styles from "../SettingsModal.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";
import { SettingsSectionHeader } from "../SettingsSectionHeader";

/** 알림 항목 정의 (Figma 1567:26085). 작업 제안은 시안에 없지만 끌 수 있어야 해서 시안 항목 뒤에 남긴다. */
const NOTIFICATION_ROWS: { key: NotificationKey; label: string; description: string }[] = [
  { key: "completed", label: "문서 처리 완료", description: "문서(Ingest) 분석이 끝나면 알림 카드를 표시합니다." },
  { key: "failed", label: "문서 처리 실패", description: "문서 처리가 실패하면 알림 카드를 표시합니다." },
  { key: "lint", label: "위키 최신화", description: "위키 최신화 작업이 끝나면 알립니다." },
  { key: "restore", label: "복구(롤백)", description: "AI 작업 되돌리기가 끝나면 알립니다." },
  { key: "query", label: "질의 완료", description: "채팅 질의의 답변 도착•실패를 알립니다." },
  { key: "browser", label: "브라우저 알림", description: "탭이 백그라운드일 때 브라우저 알림으로도 보냅니다." },
  { key: "suggest", label: "작업 제안", description: "위키 편입이나 위키 최신화가 필요한 문서가 있으면 실행을 제안합니다." }
];

/** 알림 설정 (Figma 1567:26085). 알림 설정은 이 패널에서만 바꾼다. 설정값은 이 기기(브라우저)에 저장된다. */
export function NotificationsPanel() {
  const { checkedValues, browserMessage, toggleNotification } = useNotificationToggles();

  return (
    <div className={styles.detail}>
      <SettingsPanelTitle title="알림 설정" description="알림 설정 리스트입니다." />

      <div className={styles.section}>
        <SettingsSectionHeader>알림 설정</SettingsSectionHeader>
        {NOTIFICATION_ROWS.map(({ key, label, description }) => (
          <div key={key} className={cx(styles.row, styles["row-loose"])}>
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
