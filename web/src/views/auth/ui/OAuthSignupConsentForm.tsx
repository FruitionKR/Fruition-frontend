"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  buildSignupConsentFields,
  completeOAuthSignup,
  consentErrorMessage,
  EMPTY_CONSENT,
  isSignupConsentReady,
  isSignupEmailRegistered,
  isSignupTokenConsumed,
  registeredEmailErrorMessage,
  type ConsentChoices
} from "@/entities/user";
import { ConsentForm } from "@/features/legal-consent";
import { LEGAL_PAGES_ENABLED, LEGAL_TERMS_VERSION } from "@/shared/config/legal";
import { saveAccessToken, takeAfterLoginPath } from "@/shared/lib/authSessionStorage";
import { AuthError, AuthSubmitButton } from "@/shared/ui/auth/AuthControls";

/**
 * 소셜 신규 가입 동의 단계. OAuth 콜백의 signup_token(10분, 1회용)으로 동의를 보내 계정을 만들고 로그인한다.
 * 다른 탭이 먼저 가입을 끝낸 계정이 MFA를 켰으면 MFA 단계로 넘긴다.
 * 그사이 같은 이메일로 다른 가입이 끝나 409 EMAIL_REGISTERED가 오면 토큰이 소비됐으므로 재시도 없이 로그인 화면으로 보낸다(access #31).
 * 약관 공개 플래그(LEGAL_PAGES_ENABLED)가 꺼져 있으면 동의 화면 없이 동의 필드 없는 요청으로 바로 가입을 마친다(서버 LEGAL_CONSENT_REQUIRED=false와 짝).
 */
export function OAuthSignupConsentForm({
  signupToken,
  onMfaRequired,
  onRestart
}: {
  signupToken: string;
  onMfaRequired: (mfaToken: string) => void;
  /** 토큰이 만료·사용됐거나 같은 이메일의 계정이 있어 로그인 화면으로 돌아갈 때 */
  onRestart: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [choices, setChoices] = useState<ConsentChoices>(EMPTY_CONSENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTokenInvalid, setIsTokenInvalid] = useState(false);
  const [isEmailRegistered, setIsEmailRegistered] = useState(false);
  const hasAutoSubmitted = useRef(false);

  // 동의 UI가 꺼져 있으면 물을 것이 없어 바로 가입을 마친다. 토큰이 1회용이라 개발 모드의 effect 재실행에도 한 번만 보낸다.
  useEffect(() => {
    if (LEGAL_PAGES_ENABLED || hasAutoSubmitted.current) return;
    hasAutoSubmitted.current = true;
    void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const body = buildSignupConsentFields(LEGAL_PAGES_ENABLED, choices, LEGAL_TERMS_VERSION);
    if (busy || !body || isTokenInvalid) return;
    setBusy(true);
    setError(null);
    try {
      const tokens = await completeOAuthSignup(signupToken, body);
      if (tokens.mfa_required) {
        onMfaRequired(tokens.mfa_token);
        return;
      }
      saveAccessToken(tokens.access_token);
      queryClient.clear();
      router.replace(takeAfterLoginPath());
    } catch (cause: unknown) {
      setError(registeredEmailErrorMessage(cause) ?? consentErrorMessage(cause, "회원가입에 실패했습니다."));
      setIsTokenInvalid(isSignupTokenConsumed(cause));
      setIsEmailRegistered(isSignupEmailRegistered(cause));
      setBusy(false);
    }
  }

  return <>
    <p className="auth-prompt auth-prompt--wrap" role={LEGAL_PAGES_ENABLED ? undefined : "status"}>
      {LEGAL_PAGES_ENABLED
        ? "소셜 계정으로 처음 가입합니다. 아래 항목에 동의하면 가입이 완료됩니다."
        : "소셜 계정으로 처음 가입합니다. 가입을 완료하고 있습니다."}
    </p>
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <div className="auth-field-with-error">
        {LEGAL_PAGES_ENABLED ? <ConsentForm disabled={busy || isTokenInvalid} idPrefix="oauth-consent" onChange={setChoices} value={choices} /> : null}
        {error ? <AuthError>{error}</AuthError> : null}
      </div>
      {/* 동의 UI가 꺼져 있으면 자동 가입이 실패했을 때만 다시 시도 버튼을 보인다. */}
      {LEGAL_PAGES_ENABLED || error ? (
        <AuthSubmitButton disabled={busy || isTokenInvalid || !isSignupConsentReady(LEGAL_PAGES_ENABLED, choices)}>
          {busy ? "가입 중…" : LEGAL_PAGES_ENABLED ? "동의하고 가입" : "가입 다시 시도"}
        </AuthSubmitButton>
      ) : null}
    </form>
    <p className="auth-prompt"><button disabled={busy} onClick={onRestart} type="button">{isEmailRegistered ? "로그인 화면으로" : "로그인부터 다시 시작"}</button></p>
  </>;
}
