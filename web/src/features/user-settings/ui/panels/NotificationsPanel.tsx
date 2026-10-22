import { useNotificationToggles, type NotificationKey } from "../../model/useNotificationToggles";
import { cx } from "@/shared/lib/classNames";
import { Switch } from "@/shared/ui/Switch";
import styles from "../SettingsModal.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";
import { SettingsSectionHeader } from "../SettingsSectionHeader";
import { isNotificationControlEnabled, NOTIFICATION_SETTINGS } from "@/entities/user/model/preferences";

const NOTIFICATION_ROWS = Object.entries(NOTIFICATION_SETTINGS)
  .map(([key, setting]) => ({ key: key as NotificationKey, ...setting }));
const NOTIFICATION_GROUPS = [...new Set(NOTIFICATION_ROWS.map((row) => row.group))];
function NotificationControlRow({ label, checked, disabled = false, onChange }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className={cx(styles.row, styles["is-compact"], disabled && styles["is-disabled"])}>
      <div className={styles["row-title"]}>
        <strong>{label}</strong>
      </div>
      <Switch checked={checked} disabled={disabled} label={label} onClick={() => onChange(!checked)} />
    </div>
  );
}

/** 알림 설정 (Figma 1567:26085). 알림 설정은 이 패널에서만 바꾼다. 설정값은 이 기기(브라우저)에 저장된다. */
export function NotificationsPanel() {
  const { checkedValues, browserMessage, toggleNotification, notificationControls, setAllNotificationsEnabled, setGroupNotificationsEnabled } = useNotificationToggles();

  return (
    <div className={styles.detail}>
      <SettingsPanelTitle title="알림 설정" description="우하단 알림 카드를 종류별로 켜고 끕니다. 알림 기록과 작업 결과는 삭제되지 않습니다." />

      <div className={cx(styles.section, styles["notification-master-section"])}>
        <NotificationControlRow
          label="전체 알림"
          checked={notificationControls.enabled}
          onChange={setAllNotificationsEnabled}
        />
      </div>

      {NOTIFICATION_GROUPS.map((group) => (
        <div key={group} className={styles.section}>
          <SettingsSectionHeader prominent action={
            <div className={cx(styles["notification-group-control"], !notificationControls.enabled && styles["is-disabled"])}>
              <span>전체 알림 설정</span>
              <Switch
                checked={notificationControls.groups[group] !== false}
                disabled={!notificationControls.enabled}
                label={`${group} 전체 알림 설정`}
                onClick={() => setGroupNotificationsEnabled(group, notificationControls.groups[group] === false)}
              />
            </div>
          }>{group}</SettingsSectionHeader>
          {NOTIFICATION_ROWS
            .filter((row) => row.group === group)
            .sort((a, b) => a.label.localeCompare(b.label, "ko", { numeric: true, sensitivity: "base" }))
            .map(({ key, label, description }) => (
            <div key={key} className={cx(styles.row, styles["row-loose"], !isNotificationControlEnabled(key, notificationControls) && styles["is-disabled"])}>
              <div className={styles["row-title"]}>
                <strong>{label}</strong>
                <small>{description}</small>
                {key === "browser" && browserMessage && <small className={styles["row-error"]} role="alert">{browserMessage}</small>}
              </div>
              <Switch
                checked={checkedValues[key]}
                disabled={!isNotificationControlEnabled(key, notificationControls)}
                label={label}
                onClick={() => void toggleNotification(key)}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
