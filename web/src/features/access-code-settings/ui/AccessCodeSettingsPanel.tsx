"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { useUserPreferences, type UserPreferences } from "@/entities/user";
import { LegalFooter } from "@/shared/ui/LegalFooter";
import { OptionSelect } from "@/shared/ui/OptionSelect";
import { Switch } from "@/shared/ui/Switch";
import { AccessCodeSection } from "./AccessCodeSection";
import styles from "./AccessCodeSettingsPanel.module.css";

const MOTION_VALUES: ReadonlyArray<UserPreferences["motion"]> = ["system", "reduced", "full"];

const GRAPH_KINDS = ["raw", "source", "concept"] as const;

const DOCUMENT_FONT_OPTIONS: ReadonlyArray<{ value: UserPreferences["documentFont"]; label: string }> = [
  { value: "system-sans", label: "System Sans" },
  { value: "readable-sans", label: "Readable Sans" },
  { value: "serif", label: "Serif" }
];

function SettingRow({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={styles["settings-field"]}>
      <div className={styles["settings-label"]}>
        <p>{title}</p>
        <span>{description}</span>
      </div>
      {children}
    </div>
  );
}

function SettingSwitch({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Switch
      checked={checked}
      label={label}
      classNames={{ root: styles["settings-toggle"], on: styles["is-on"] }}
      onClick={() => onChange(!checked)}
    />
  );
}

export function AccessCodeSettingsPanel() {
  const t = useTranslations("workspace.personalSettings");
  const { preferences, updatePreferences, resetPreferences } = useUserPreferences();
  const [browserNotificationMessage, setBrowserNotificationMessage] = useState<"unsupported" | "permissionRequired" | null>(null);
  const motionOptions = MOTION_VALUES.map((value) => ({ value, label: t(`motion.options.${value}`) }));

  function updateGraphKind(kind: keyof UserPreferences["graph"]["visibleKinds"], visible: boolean) {
    updatePreferences((current) => {
      const visibleKinds = { ...current.graph.visibleKinds, [kind]: visible };
      if (!Object.values(visibleKinds).some(Boolean)) return current;
      return { ...current, graph: { ...current.graph, visibleKinds } };
    });
  }

  async function changeBrowserNotifications(enabled: boolean) {
    setBrowserNotificationMessage(null);
    if (!enabled) {
      updatePreferences((current) => ({
        ...current,
        notifications: { ...current.notifications, browser: false }
      }));
      return;
    }

    if (!("Notification" in window)) {
      setBrowserNotificationMessage("unsupported");
      return;
    }

    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== "granted") {
      setBrowserNotificationMessage("permissionRequired");
      return;
    }

    updatePreferences((current) => ({
      ...current,
      notifications: { ...current.notifications, browser: true }
    }));
  }

  return (
    <section className={styles["settings"]} aria-label={t("title")}>
      <div className={styles["settings-inner"]}>
        <header className={styles["settings-header"]}>
          <div>
            <h2>{t("title")}</h2>
            <p>{t("description")}</p>
          </div>
          <button type="button" className={styles["settings-reset"]} onClick={resetPreferences}>
            <RotateCcw size={14} aria-hidden />
            {t("reset")}
          </button>
        </header>

        <AccessCodeSection />

        <section className={styles["settings-section"]}>
          <h3>{t("display")}</h3>
          <SettingRow
            title={t("motion.title")}
            description={t("motion.description")}
          >
            <div className={styles["settings-select"]}>
              <OptionSelect
                ariaLabel={t("motion.title")}
                value={preferences.motion}
                placeholder=""
                options={motionOptions}
                floating
                onChange={(motion) => updatePreferences((current) => ({
                  ...current,
                  motion: motion as UserPreferences["motion"]
                }))}
              />
            </div>
          </SettingRow>
          <SettingRow
            title={t("documentFont.title")}
            description={t("documentFont.description")}
          >
            <div className={styles["settings-select"]}>
              <OptionSelect
                ariaLabel={t("documentFont.title")}
                value={preferences.documentFont}
                placeholder=""
                options={DOCUMENT_FONT_OPTIONS}
                floating
                onChange={(documentFont) => updatePreferences((current) => ({
                  ...current,
                  documentFont: documentFont as UserPreferences["documentFont"]
                }))}
              />
            </div>
          </SettingRow>
        </section>

        <section className={styles["settings-section"]}>
          <h3>{t("graph.title")}</h3>
          <p className={styles["settings-section-description"]}>
            {t("graph.description")}
          </p>
          {GRAPH_KINDS.map((kind) => (
            <SettingRow key={kind} title={t(`graph.kinds.${kind}.title`)} description={t(`graph.kinds.${kind}.description`)}>
              <SettingSwitch
                checked={preferences.graph.visibleKinds[kind]}
                label={t("graph.showKind", { kind: t(`graph.kinds.${kind}.title`) })}
                onChange={(visible) => updateGraphKind(kind, visible)}
              />
            </SettingRow>
          ))}
        </section>

        <section className={styles["settings-section"]}>
          <h3>{t("notifications.title")}</h3>
          <SettingRow title={t("notifications.completed.title")} description={t("notifications.completed.description")}>
            <SettingSwitch
              checked={preferences.notifications.completed}
              label={t("notifications.completed.label")}
              onChange={(completed) => updatePreferences((current) => ({
                ...current,
                notifications: { ...current.notifications, completed }
              }))}
            />
          </SettingRow>
          <SettingRow title={t("notifications.failed.title")} description={t("notifications.failed.description")}>
            <SettingSwitch
              checked={preferences.notifications.failed}
              label={t("notifications.failed.label")}
              onChange={(failed) => updatePreferences((current) => ({
                ...current,
                notifications: { ...current.notifications, failed }
              }))}
            />
          </SettingRow>
          <SettingRow
            title={t("notifications.browser.title")}
            description={t("notifications.browser.description")}
          >
            <SettingSwitch
              checked={preferences.notifications.browser}
              label={t("notifications.browser.title")}
              onChange={(enabled) => void changeBrowserNotifications(enabled)}
            />
          </SettingRow>
          {browserNotificationMessage && (
            <p className={styles["settings-message"]} role="status">{t(`notifications.browser.${browserNotificationMessage}`)}</p>
          )}
        </section>
        <LegalFooter compact />
      </div>
    </section>
  );
}
