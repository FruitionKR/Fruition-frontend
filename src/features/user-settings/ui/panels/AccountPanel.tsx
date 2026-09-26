"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ME_QUERY_KEY, SESSIONS_QUERY_KEY, updateDisplayName, useMe, useSignOut } from "@/entities/user";
import { EmailChangeModal } from "./EmailChangeModal";
import { PasswordChangeModal } from "./PasswordChangeModal";
import { SessionsPanel } from "./SessionsPanel";
import { MfaPanel } from "./MfaPanel";
import { getErrorMessage } from "@/shared/lib/errors";
import styles from "../SettingsModal.module.css";
import panelStyles from "./AccountPanel.module.css";

/** 계정 설정 패널 (Figma 1127:5275). */
export function AccountPanel() {
  const { data: me, error: loadError } = useMe();
  const queryClient = useQueryClient();
  const { signOut } = useSignOut();
  const [nicknameDraft, setNicknameDraft] = useState<string | null>(null);
  const nickname = nicknameDraft ?? me?.display_name ?? "";
  const nameRequestPending = useRef(false);
  const [composingName, setComposingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);

  const saveName = useCallback(async () => {
    if (!me || nameRequestPending.current || composingName || nicknameDraft === null || !nickname.trim() || nickname.trim() === me.display_name) return;
    nameRequestPending.current = true;
    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    try {
      const updated = await updateDisplayName(nickname.trim());
      // 설정 메뉴와 사이드바가 같은 사용자 캐시를 사용한다.
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      void queryClient.invalidateQueries({ queryKey: ["workspace-members"] });
      setNicknameDraft((current) => current === nickname ? null : current);
      setNameSaved(true);
    } catch (error: unknown) {
      setNameError(getErrorMessage(error, "닉네임을 변경하지 못했습니다."));
    } finally {
      nameRequestPending.current = false;
      setSavingName(false);
    }
  }, [me, nickname, nicknameDraft, composingName, queryClient]);

  useEffect(() => {
    if (savingName || nameError || composingName || nicknameDraft === null) return;
    const timer = window.setTimeout(() => void saveName(), 600);
    return () => window.clearTimeout(timer);
  }, [saveName, savingName, nameError, composingName, nicknameDraft]);

  return (
    <div className={styles.detail}>
      <>
      <div className={styles.title}>
        <div className={styles["title-row"]}>
          <h2>계정 설정</h2>
        </div>
        <p>개인 계정 설정을 관리합니다.</p>
      </div>

      <div className={styles.section}>
        <div className={styles["section-header"]}>
          <span>프로필</span>
          <span className={styles["section-line"]} />
        </div>
        <div className={styles.field}>
          <label htmlFor="account-nickname">닉네임</label>
          <input id="account-nickname" type="text" value={nickname} maxLength={255} required
            disabled={!me} onChange={(event) => { setNicknameDraft(event.target.value); setNameSaved(false); setNameError(null); }}
            onCompositionStart={() => setComposingName(true)} onCompositionEnd={() => setComposingName(false)}
            onBlur={() => void saveName()} />
          {(nameError || loadError) && <small className={styles["model-error"]} role="alert">{nameError || getErrorMessage(loadError, "계정 정보를 불러오지 못했습니다.")}</small>}
          {savingName ? <small role="status">저장 중…</small> : nameSaved && nicknameDraft === null && <small role="status">닉네임을 변경했습니다.</small>}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles["section-header"]}>
          <span>계정 정보</span>
          <span className={styles["section-line"]} />
        </div>
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>이메일</strong>
            <small>{me?.email || "이메일 정보를 불러오지 못했습니다."}</small>
          </div>
          <button type="button" className={styles.btn} disabled={!me}
            onClick={() => { setShowEmail(true); setEmailSaved(false); }}>
            이메일 변경
          </button>
        </div>
        {showEmail && (
          <EmailChangeModal
            onSaved={() => { setShowEmail(false); setEmailSaved(true); }}
            onClose={() => setShowEmail(false)}
          />
        )}
        {emailSaved && <small role="status">이메일을 변경했습니다.</small>}
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>비밀번호</strong>
            <small>로그인에 사용하는 비밀번호를 변경하세요.</small>
          </div>
          <button
            type="button"
            className={styles.btn}
            disabled={!me}
            onClick={() => setShowPassword(true)}
          >
            비밀번호 변경
          </button>
        </div>
        {showPassword && me && (
          <PasswordChangeModal
            email={me.email}
            // 비밀번호를 바꾸면 서버가 모든 refresh 토큰을 폐기하므로 다시 로그인해야 한다.
            onSaved={() => { setShowPassword(false); void signOut({ callLogout: true }); }}
            onClose={() => setShowPassword(false)}
          />
        )}
      </div>

      </>
      <div className={styles.section}>
        <div className={styles["section-header"]}>
          <span>계정 보안</span>
          <span className={styles["section-line"]} />
        </div>
        {me && <MfaPanel />}
        {me && <SessionsPanel />}
      </div>
    </div>
  );
}
