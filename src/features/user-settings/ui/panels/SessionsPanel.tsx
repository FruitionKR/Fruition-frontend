"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSessions, revokeSession, SESSIONS_QUERY_KEY, useSignOut, type LoginSession } from "@/entities/user";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/errors";
import { computerIcon, phoneIcon, retryIcon, settingScrollIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import styles from "../SettingsModal.module.css";
import panelStyles from "./AccountPanel.module.css";

/** 휴대기기(iOS·Android 등) 여부. 아이콘 선택에만 쓴다. */
function isMobileDevice(userAgent: string | null): boolean {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent ?? "");
}

/** user-agent 문자열에서 기기(OS) 이름을 뽑는다 (Figma: macOS, iPhone). */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "알 수 없는 기기";
  return /iPhone/.test(userAgent) ? "iPhone"
    : /iPad/.test(userAgent) ? "iPad"
      : /Android/.test(userAgent) ? "Android"
        : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
          : /Windows/.test(userAgent) ? "Windows"
            : /Linux/.test(userAgent) ? "Linux"
              : userAgent;
}

/** 최근 활동 표기 (Figma: "지금", "2026년 4월 20일 오후 6시"). */
function formatActivity(session: LoginSession): string {
  if (session.current) return "지금";
  return new Date(session.created_at).toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "numeric" });
}

/** 로그인된 기기 행과 기기 목록 표 (Figma 1131:5851, 1131:5859). 현재 기기는 "이 기기"로 강조한다. */
export function SessionsPanel() {
  const { data: sessions, isPending, error: loadError, refetch } = useQuery({
    queryKey: SESSIONS_QUERY_KEY, queryFn: fetchSessions, retry: false
  });
  const { signOut } = useSignOut();
  const [isOpen, setIsOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function remove(session: LoginSession) {
    if (busy || !window.confirm(session.current ? "현재 기기에서 로그아웃하시겠습니까?" : "이 기기를 로그아웃하시겠습니까?")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await revokeSession(session.session_id);
      if (session.current) {
        await signOut({ callLogout: true });
        return;
      }
      setMessage("기기의 로그인 갱신을 해제했습니다.");
      void refetch();
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "기기를 로그아웃하지 못했습니다."));
      void refetch();
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className={cx(styles.row, panelStyles["sessions-row"])}>
      <div className={styles["row-title"]}>
        <strong>로그인된 기기</strong>
        <small>여러 기기에서 로그인 중인 기기 수에요.</small>
      </div>
      <div className={panelStyles["sessions-actions"]}>
        <button type="button" className={panelStyles["sessions-refresh"]} aria-label="로그인된 기기 새로고침"
          disabled={busy || isPending} onClick={() => void refetch()}>
          <SvgIcon src={retryIcon} className={panelStyles["sessions-refresh-icon"]} />
        </button>
        <button type="button" className={panelStyles["sessions-count"]} aria-expanded={isOpen} aria-controls="account-device-list"
          onClick={() => setIsOpen((open) => !open)}>
          {isPending ? "불러오는 중…" : `${sessions?.length ?? 0}개 기기 로그인 중`}
          <SvgIcon src={settingScrollIcon} className={panelStyles["sessions-count-arrow"]} />
        </button>
      </div>
    </div>
    {isOpen && (
      <div id="account-device-list" className={panelStyles["device-table"]}>
        <div className={cx(panelStyles["device-row"], panelStyles["device-head"])} aria-hidden>
          <span>기기명</span>
          <span>최근 활동</span>
          <span>위치</span>
          <span />
        </div>
        <ul className={panelStyles["device-list"]} aria-label="로그인된 기기">
          {sessions?.map((session) => (
            <li key={session.session_id} className={panelStyles["device-row"]}>
              <div className={panelStyles["device-title"]}>
                <SvgIcon src={isMobileDevice(session.user_agent) ? phoneIcon : computerIcon} className={panelStyles["device-icon"]} />
                <div className={panelStyles["device-label"]}>
                  <span className={panelStyles["device-name"]} title={session.user_agent ?? undefined}>{describeDevice(session.user_agent)}</span>
                  {session.current && <em className={panelStyles["device-current"]}>이 기기</em>}
                </div>
              </div>
              <span className={panelStyles["device-cell"]}>{formatActivity(session)}</span>
              {/* 세션 API는 위치를 내려주지 않아 비워 둔다. */}
              <span className={cx(panelStyles["device-cell"], panelStyles["device-cell-muted"])}>알 수 없음</span>
              <button type="button" className={styles.btn} disabled={busy} onClick={() => void remove(session)}>로그아웃</button>
            </li>
          ))}
          {sessions?.length === 0 && <li className={panelStyles["device-empty"]}>로그인된 기기가 없습니다.</li>}
        </ul>
      </div>
    )}
    {message && <small role="status">{message}</small>}
    {(error || loadError) && <small className={styles["model-error"]} role="alert">{error || getErrorMessage(loadError, "로그인된 기기를 불러오지 못했습니다.")}</small>}
  </>;
}
