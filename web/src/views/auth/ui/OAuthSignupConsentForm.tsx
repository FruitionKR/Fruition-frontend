"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  buildConsentBody,
  completeOAuthSignup,
  consentErrorMessage,
  EMPTY_CONSENT,
  isConsentComplete,
  isSignupEmailRegistered,
  isSignupTokenConsumed,
  registeredEmailErrorMessage,
  type ConsentChoices
} from "@/entities/user";
import { ConsentForm } from "@/features/legal-consent";
import { LEGAL_TERMS_VERSION } from "@/shared/config/legal";
import { saveAccessToken, takeAfterLoginPath } from "@/shared/lib/authSessionStorage";
import { AuthError, AuthSubmitButton } from "@/shared/ui/auth/AuthControls";

/**
 * 소셜 신규 가입 동의 단계. OAuth 콜백의 signup_token(10분, 1회용)으로 동의를 보내 계정을 만들고 로그인한다.
 * 다른 탭이 먼저 가입을 끝낸 계정이 MFA를 켰으면 MFA 단계로 넘긴다.
 * 그사이 같은 이메일로 다른 가입이 끝나 409 EMAIL_REGISTERED가 오면 토큰이 소비됐으므로 재시도 없이 로그인 화면으로 보낸다(access #31).
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = buildConsentBody(choices, LEGAL_TERMS_VERSION);
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
    <p className="auth-prompt auth-prompt--wrap">소셜 계정으로 처음 가입합니다. 아래 항목에 동의하면 가입이 완료됩니다.</p>
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <div className="auth-field-with-error">
        <ConsentForm disabled={busy || isTokenInvalid} idPrefix="oauth-consent" onChange={setChoices} value={choices} />
        {error ? <AuthError>{error}</AuthError> : null}
      </div>
      <AuthSubmitButton disabled={busy || isTokenInvalid || !isConsentComplete(choices)}>{busy ? "가입 중…" : "동의하고 가입"}</AuthSubmitButton>
    </form>
    <p className="auth-prompt"><button disabled={busy} onClick={onRestart} type="button">{isEmailRegistered ? "로그인 화면으로" : "로그인부터 다시 시작"}</button></p>
  </>;
}
