"use client";

import { useConfirmation } from "@/shared/ui/modal/useConfirmation";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { fetchSessions, revokeSession, SESSIONS_QUERY_KEY, useSignOut, type LoginSession } from "@/entities/user";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { computerIcon, phoneIcon, retryIcon, chevronDownSmallIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import styles from "../SettingsModal.module.css";
import panelStyles from "./AccountPanel.module.css";

/** 휴대기기(iOS·Android 등) 여부. 아이콘 선택에만 쓴다. */
function isMobileDevice(userAgent: string | null): boolean {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent ?? "");
}

/** user-agent 문자열에서 기기(OS) 이름을 뽑는다 (Figma: macOS, iPhone). 알 수 없으면 null. */
function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  return /iPhone/.test(userAgent) ? "iPhone"
    : /iPad/.test(userAgent) ? "iPad"
      : /Android/.test(userAgent) ? "Android"
        : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
          : /Windows/.test(userAgent) ? "Windows"
            : /Linux/.test(userAgent) ? "Linux"
              : userAgent;
}

/** 최근 활동 표기 형식 (Figma: "지금", "2026년 4월 20일 오후 6시"). 화면 언어를 따른다. */
const ACTIVITY_FORMAT = { year: "numeric", month: "long", day: "numeric", hour: "numeric" } as const;

/** 로그인된 기기 행과 기기 목록 표 (Figma 1691:16307). 현재 기기는 "이 기기"로 강조한다. */
export function SessionsPanel() {
  const { confirm, confirmationDialog } = useConfirmation();
  const t = useTranslations("settings.sessions");
  const tCommon = useTranslations("settings.common");
  const tShared = useTranslations("shared");
  const format = useFormatter();
  const { data: sessions, isPending, error: loadError, refetch } = useQuery({
    queryKey: SESSIONS_QUERY_KEY, queryFn: fetchSessions, retry: false
  });
  const { signOut } = useSignOut();
  const [isOpen, setIsOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const deviceName = (session: LoginSession) => describeDevice(session.user_agent) ?? t("unknownDevice");
  const formatActivity = (session: LoginSession) =>
    session.current ? t("now") : format.dateTime(new Date(session.created_at), ACTIVITY_FORMAT);

  async function remove(session: LoginSession) {
    if (busy || !await confirm({ title: session.current ? t("confirmCurrent") : t("confirmOther"), confirmLabel: t("logout") })) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await revokeSession(session.session_id);
      if (session.current) {
        await signOut({ callLogout: true, reason: "user" });
        return;
      }
      setMessage(t("revoked"));
      void refetch();
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, t("revokeFailed"), tShared));
      void refetch();
    } finally {
      setBusy(false);
    }
  }

  return <>
    {confirmationDialog}
    <div className={cx(styles.row, panelStyles["sessions-row"])}>
      <div className={styles["row-title"]}>
        <strong>{t("label")}</strong>
        <small>{t("description")}</small>
      </div>
      <div className={panelStyles["sessions-actions"]}>
        <button type="button" className={panelStyles["sessions-refresh"]} aria-label={t("refresh")}
          disabled={busy || isPending} onClick={() => void refetch()}>
          <SvgIcon src={retryIcon} className={panelStyles["sessions-refresh-icon"]} />
        </button>
        <button type="button" className={panelStyles["sessions-count"]} aria-expanded={isOpen} aria-controls="account-device-list"
          onClick={() => setIsOpen((open) => !open)}>
          {isPending ? t("loading") : t("count", { count: sessions?.length ?? 0 })}
          <SvgIcon src={chevronDownSmallIcon} className={panelStyles["sessions-count-arrow"]} />
        </button>
      </div>
    </div>
    {isOpen && (
      <div id="account-device-list" className={panelStyles["device-table"]}>
        <div className={cx(panelStyles["device-row"], panelStyles["device-head"])} aria-hidden>
          <span>{t("headDevice")}</span>
          <span>{t("headActivity")}</span>
          <span>{t("headLocation")}</span>
          <span />
        </div>
        <ul className={panelStyles["device-list"]} aria-label={t("label")}>
          {sessions?.map((session) => (
            <li key={session.session_id} className={panelStyles["device-row"]}>
              <div className={panelStyles["device-title"]}>
                <SvgIcon src={isMobileDevice(session.user_agent) ? phoneIcon : computerIcon} className={panelStyles["device-icon"]} />
                <div className={panelStyles["device-label"]}>
                  <span className={panelStyles["device-name"]} title={session.user_agent ?? undefined}>{deviceName(session)}</span>
                  {session.current && <em className={panelStyles["device-current"]}>{t("thisDevice")}</em>}
                </div>
              </div>
              <span className={panelStyles["device-cell"]}>{formatActivity(session)}</span>
              {/* 세션 API는 위치를 내려주지 않아 비워 둔다. */}
              <span className={cx(panelStyles["device-cell"], panelStyles["device-cell-muted"])}>{tCommon("unknown")}</span>
              <button type="button" className={panelStyles["device-logout"]} aria-label={t("logoutLabel", { device: deviceName(session) })}
                disabled={busy} onClick={() => void remove(session)}>{t("logout")}</button>
            </li>
          ))}
          {sessions?.length === 0 && <li className={panelStyles["device-empty"]}>{t("empty")}</li>}
        </ul>
      </div>
    )}
    {message && <small className={styles["status-text"]} role="status">{message}</small>}
    {(error || loadError) && <small className={styles["field-error"]} role="alert">{error || getErrorMessage(loadError, t("loadFailed"), tShared)}</small>}
  </>;
}
