import { useLocale, useTranslations } from "next-intl";
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
// 그룹 이름은 알림 설정 저장값(notificationControls.groups)의 키라 한국어 그대로 두고, 화면 이름만 번역한다.
type NotificationGroupKey = "documents" | "wiki" | "suggestions" | "chat" | "editor" | "files" | "other" | "delivery";
const GROUP_MESSAGE_KEYS: Readonly<Record<string, NotificationGroupKey>> = {
  "문서·PDF": "documents", "위키": "wiki", "작업 제안": "suggestions", "채팅·AI": "chat",
  "편집기": "editor", "파일·폴더": "files", "기타": "other", "전달 방식": "delivery"
};
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
  const t = useTranslations("settings.notifications");
  const locale = useLocale();
  const { checkedValues, browserIssue, toggleNotification, notificationControls, setAllNotificationsEnabled, setGroupNotificationsEnabled } = useNotificationToggles();
  const groupLabel = (group: string) => {
    const key = GROUP_MESSAGE_KEYS[group];
    return key ? t(`groups.${key}`) : group;
  };
  const rowLabel = (key: NotificationKey) => t(`items.${key}`);
  const rowDescription = (key: NotificationKey) =>
    key === "browser" ? t("browserDescription") : key === "server" ? t("serverDescription") : t("itemDescription", { label: rowLabel(key) });
  const browserMessage = browserIssue === "unsupported" ? t("browserUnsupported") : browserIssue === "denied" ? t("browserDenied") : null;

  return (
    <div className={styles.detail}>
      <SettingsPanelTitle title={t("title")} description={t("description")} />

      <div className={cx(styles.section, styles["notification-master-section"])}>
        <NotificationControlRow
          label={t("all")}
          checked={notificationControls.enabled}
          onChange={setAllNotificationsEnabled}
        />
      </div>

      {NOTIFICATION_GROUPS.map((group) => (
        <div key={group} className={styles.section}>
          <SettingsSectionHeader prominent action={
            <div className={cx(styles["notification-group-control"], !notificationControls.enabled && styles["is-disabled"])}>
              <span>{t("groupAll")}</span>
              <Switch
                checked={notificationControls.groups[group] !== false}
                disabled={!notificationControls.enabled}
                label={t("groupAllLabel", { group: groupLabel(group) })}
                onClick={() => setGroupNotificationsEnabled(group, notificationControls.groups[group] === false)}
              />
            </div>
          }>{groupLabel(group)}</SettingsSectionHeader>
          {NOTIFICATION_ROWS
            .filter((row) => row.group === group)
            .map((row) => ({ key: row.key, label: rowLabel(row.key), description: rowDescription(row.key) }))
            .sort((a, b) => a.label.localeCompare(b.label, locale, { numeric: true, sensitivity: "base" }))
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
