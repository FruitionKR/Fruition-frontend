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
  isSignupTokenInvalid,
  type ConsentChoices
} from "@/entities/user";
import { ConsentForm } from "@/features/legal-consent";
import { LEGAL_TERMS_VERSION } from "@/shared/config/legal";
import { saveAccessToken, takeAfterLoginPath } from "@/shared/lib/auth";
import { AuthError, AuthSubmitButton } from "@/shared/ui/AuthControls";

/**
 * 소셜 신규 가입 동의 단계. OAuth 콜백의 signup_token(10분, 1회용)으로 동의를 보내 계정을 만들고 로그인한다.
 * 다른 탭이 먼저 가입을 끝낸 계정이 MFA를 켰으면 MFA 단계로 넘긴다.
 */
export function OAuthSignupConsentForm({
  signupToken,
  onMfaRequired,
  onRestart
}: {
  signupToken: string;
  onMfaRequired: (mfaToken: string) => void;
  /** 토큰이 만료·사용돼 소셜 로그인부터 다시 해야 할 때 */
  onRestart: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [choices, setChoices] = useState<ConsentChoices>(EMPTY_CONSENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTokenInvalid, setIsTokenInvalid] = useState(false);

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
      setError(consentErrorMessage(cause, "회원가입에 실패했습니다."));
      setIsTokenInvalid(isSignupTokenInvalid(cause));
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
    <p className="auth-prompt"><button disabled={busy} onClick={onRestart} type="button">로그인부터 다시 시작</button></p>
  </>;
}
