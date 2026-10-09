"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getOAuthLinkAuthorizationUrl,
  ME_QUERY_KEY,
  OAUTH_PROVIDER_OPTIONS,
  oauthAccountErrorMessage,
  oauthProviderName,
  SESSIONS_QUERY_KEY,
  startOAuthLink,
  takeOAuthLinkResult,
  unlinkOAuthAccount,
  updateDisplayName,
  useMe,
  useSignOut,
  type OAuthLinkResult,
  type OAuthProvider
} from "@/entities/user";
import { setAfterLoginPath } from "@/shared/lib/auth";
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
  const [oauthPending, setOAuthPending] = useState<OAuthProvider | null>(null);
  const [oauthResult, setOAuthResult] = useState<OAuthLinkResult | null>(null);
  const linkedProviders = me?.oauth_providers ?? [];

  // 연동 콜백이 남긴 결과를 한 번만 읽어 이 섹션에 보여 준다.
  useEffect(() => {
    const result = takeOAuthLinkResult();
    if (result) setOAuthResult(result);
  }, []);

  // 소셜 인증 화면에서 뒤로 가기로 bfcache 복원되면 이동 직전의 "처리 중" 상태가 그대로 남는다.
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) setOAuthPending(null);
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  async function linkProvider(provider: OAuthProvider) {
    setOAuthPending(provider);
    setOAuthResult(null);
    try {
      const linkToken = await startOAuthLink(provider);
      // 소셜 인증을 마치면 콜백 페이지가 이 화면으로 되돌려 보낸다.
      setAfterLoginPath(`${window.location.pathname}${window.location.search}`);
      window.location.assign(getOAuthLinkAuthorizationUrl(provider, linkToken));
    } catch (error: unknown) {
      setOAuthResult({ ok: false, message: oauthAccountErrorMessage(error, "소셜 계정 연동을 시작하지 못했습니다.") });
      setOAuthPending(null);
    }
  }

  async function unlinkProvider(provider: OAuthProvider) {
    setOAuthPending(provider);
    setOAuthResult(null);
    try {
      await unlinkOAuthAccount(provider);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      setOAuthResult({ ok: true, message: `${oauthProviderName(provider)} 연동을 해제했습니다.` });
    } catch (error: unknown) {
      setOAuthResult({ ok: false, message: oauthAccountErrorMessage(error, "소셜 계정 연동을 해제하지 못했습니다.") });
    } finally {
      setOAuthPending(null);
    }
  }

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

      <div className={styles.section}>
        <div className={styles["section-header"]}>
          <span>연결된 계정</span>
          <span className={styles["section-line"]} />
        </div>
        {OAUTH_PROVIDER_OPTIONS.map(({ provider, name }) => {
          const isLinked = linkedProviders.includes(provider);
          return (
            <div className={styles.row} key={provider}>
              <div className={styles["row-title"]}>
                <strong>{name}</strong>
                <small>{isLinked ? `${name} 계정으로 로그인할 수 있습니다.` : "연결되지 않음"}</small>
              </div>
              <button
                type="button"
                className={styles.btn}
                disabled={!me || oauthPending !== null}
                onClick={() => void (isLinked ? unlinkProvider(provider) : linkProvider(provider))}
              >
                {oauthPending === provider ? "처리 중…" : isLinked ? "연동 해제" : "연동"}
              </button>
            </div>
          );
        })}
        {oauthResult && (oauthResult.ok
          ? <small role="status">{oauthResult.message}</small>
          : <small className={styles["model-error"]} role="alert">{oauthResult.message}</small>)}
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
