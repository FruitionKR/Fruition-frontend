"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSessions, revokeSession, SESSIONS_QUERY_KEY, useSignOut, type LoginSession } from "@/entities/user";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/errors";
import { computerIcon, phoneIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import styles from "../SettingsModal.module.css";
import panelStyles from "./AccountPanel.module.css";

/** 휴대기기(iOS·Android 등) 여부. 아이콘 선택에만 쓴다. */
function isMobileDevice(userAgent: string | null): boolean {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent ?? "");
}

/** user-agent 문자열에서 사람이 읽을 기기 이름을 뽑는다. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "알 수 없는 기기";
  const os = /iPhone|iPad/.test(userAgent) ? "iOS"
    : /Android/.test(userAgent) ? "Android"
      : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
        : /Windows/.test(userAgent) ? "Windows"
          : /Linux/.test(userAgent) ? "Linux"
            : null;
  const browser = /Edg\//.test(userAgent) ? "Edge"
    : /OPR\//.test(userAgent) ? "Opera"
      : /Chrome\//.test(userAgent) ? "Chrome"
        : /Safari\//.test(userAgent) ? "Safari"
          : /Firefox\//.test(userAgent) ? "Firefox"
            : null;
  const parts = [browser, os].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : userAgent;
}

/** 로그인된 기기 목록 (Figma 1127:5249의 목록 행 형태). 현재 기기는 강조한다. */
export function SessionsPanel() {
  const { data: sessions, isPending, error: loadError, refetch } = useQuery({
    queryKey: SESSIONS_QUERY_KEY, queryFn: fetchSessions, retry: false
  });
  const { signOut } = useSignOut();
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
    <div className={styles.row}>
      <div className={styles["row-title"]}>
        <strong>로그인된 기기</strong>
        <small>로그인한 기기를 확인하고 로그아웃할 수 있습니다. 로그아웃한 기기도 기존 인증이 만료될 때까지 잠시 접근할 수 있습니다.</small>
      </div>
      <button type="button" className={styles.btn} disabled={busy || isPending} onClick={() => void refetch()}>
        {isPending ? "불러오는 중…" : "새로고침"}
      </button>
    </div>
    <ul className={panelStyles["device-list"]} aria-label="로그인된 기기">
      {sessions?.map((session) => (
        <li key={session.session_id} className={cx(panelStyles["device-row"], session.current && panelStyles["is-current"])}>
          <SvgIcon src={isMobileDevice(session.user_agent) ? phoneIcon : computerIcon} className={panelStyles["device-icon"]} />
          <div className={panelStyles["device-text"]}>
            <span className={panelStyles["device-name"]}>
              {describeDevice(session.user_agent)}
              {session.current && <em>현재 기기</em>}
            </span>
            <span className={panelStyles["device-meta"]} title={session.user_agent ?? undefined}>
              {new Date(session.created_at).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })} 로그인
            </span>
          </div>
          <button type="button" className={styles.btn} disabled={busy} onClick={() => void remove(session)}>로그아웃</button>
        </li>
      ))}
      {sessions?.length === 0 && <li className={panelStyles["device-empty"]}>로그인된 기기가 없습니다.</li>}
    </ul>
    {message && <small role="status">{message}</small>}
    {(error || loadError) && <small className={styles["model-error"]} role="alert">{error || getErrorMessage(loadError, "로그인된 기기를 불러오지 못했습니다.")}</small>}
  </>;
}
