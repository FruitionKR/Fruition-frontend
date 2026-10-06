"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { exchangeOAuthCode, loginWithEmail, useMe } from "@/entities/user";
import { saveAccessToken, takeAfterLoginPath } from "@/shared/lib/auth";
import { AuthError, AuthField, AuthSubmitButton, SocialLoginButtons } from "@/shared/ui/AuthControls";
import { AuthScreen, AuthScreenBlank } from "@/shared/ui/AuthScreen";
import { MfaLoginForm } from "@/views/auth/ui/MfaLoginForm";
import { useServerWake, type AccessCodeResult } from "@/views/login/model/useServerWake";

const INVALID_CREDENTIALS_MESSAGE = "가입하지 않은 아이디거나, 잘못된 비밀번호입니다.";
const SERVER_PREPARING_MESSAGE = "서버가 아직 준비 중이에요. 준비가 끝나면 다시 로그인해 주세요.";
const ACCESS_CODE_ERROR_ID = "login-access-code-error";
const ACCESS_CODE_MESSAGES: Record<Exclude<AccessCodeResult, "ok">, string> = {
  invalid: "접근 코드가 올바르지 않습니다.",
  error: "접근 코드를 확인하지 못했어요. 다시 시도해 주세요.",
  "rate-limited": "시도 횟수가 너무 많아요. 잠시 후 다시 시도해 주세요."
};

const LEGACY_AUTH_ROUTES: Record<string, string> = {
  signup: "/signup",
  "signup-verification": "/signup/verify",
  "forgot-password": "/forgot-password",
  "reset-password": "/reset-password"
};

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthScreenBlank />}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const hasHandledOAuth = useRef(false);
  const isLoginRequestInFlight = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null);
  const {
    isPreparing,
    isWakeTimedOut,
    isAccessCodeVisible,
    isAccessCodeVerified,
    unlockAccessCode,
    requestBeforeSubmit,
    isServerUnready
  } = useServerWake();
  const hasOAuthParams = Boolean(searchParams.get("code") || searchParams.get("error"));
  // refresh 쿠키로 세션이 살아 있으면 로그인 폼 대신 바로 워크스페이스로 보낸다.
  // OAuth 콜백(code/error)이 붙어 있으면 그 처리가 우선이라 건너뛴다.
  const { isSuccess: isAlreadySignedIn } = useMe({ enabled: !hasOAuthParams && !mfaToken });

  useEffect(() => {
    if (isAlreadySignedIn) router.replace(takeAfterLoginPath());
  }, [isAlreadySignedIn, router]);

  useEffect(() => {
    const legacyRoute = LEGACY_AUTH_ROUTES[searchParams.get("view") ?? ""];
    if (legacyRoute) {
      router.replace(legacyRoute);
      return;
    }

    if (hasHandledOAuth.current) return;

    const code = searchParams.get("code");
    const oauthError = searchParams.get("error");
    if (!code && !oauthError) return;

    hasHandledOAuth.current = true;
    window.history.replaceState({}, "", window.location.pathname);

    if (oauthError) {
      setErrorMessage("간편 로그인에 실패했습니다.");
      return;
    }

    setIsSubmitting(true);
    exchangeOAuthCode(code as string)
      .then((tokens) => {
        if (tokens.mfa_required) {
          setMfaToken(tokens.mfa_token);
          setIsSubmitting(false);
          return;
        }
        saveAccessToken(tokens.access_token);
        queryClient.clear();
        router.replace(takeAfterLoginPath());
      })
      .catch(() => {
        setErrorMessage("간편 로그인에 실패했습니다.");
        setIsSubmitting(false);
      });
  }, [queryClient, router, searchParams]);

  // 칸을 벗어나면 바로 확인해, 이메일·비밀번호를 입력하는 동안 서버 기동이 시작되게 한다.
  async function handleAccessCodeBlur() {
    if (isAccessCodeVerified || !accessCode.trim()) return;
    const result = await unlockAccessCode(accessCode);
    setAccessCodeError(result === "ok" ? null : ACCESS_CODE_MESSAGES[result]);
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting || isLoginRequestInFlight.current) return;

    isLoginRequestInFlight.current = true;
    setErrorMessage(null);
    setIsSubmitting(true);

    // 접근 코드는 선택 입력이다. 적었으면 로그인 전에 확인하고, 틀리면 로그인 요청을 보내지 않는다.
    if (isAccessCodeVisible && !isAccessCodeVerified && accessCode.trim()) {
      const result = await unlockAccessCode(accessCode);
      if (result !== "ok") {
        setAccessCodeError(ACCESS_CODE_MESSAGES[result]);
        isLoginRequestInFlight.current = false;
        setIsSubmitting(false);
        return;
      }
    }
    requestBeforeSubmit();

    try {
      const tokens = await loginWithEmail(email, password);
      if (tokens.mfa_required) {
        setMfaToken(tokens.mfa_token);
        setPassword("");
        setIsSubmitting(false);
        isLoginRequestInFlight.current = false;
        return;
      }
      saveAccessToken(tokens.access_token);
      queryClient.clear();
      router.replace(takeAfterLoginPath());
    } catch {
      isLoginRequestInFlight.current = false;
      // 서버 준비 중의 실패는 자격 증명 문제가 아니다. 자동 재전송하지 않고 사용자가 다시 누르게 한다.
      // 제출 시점 렌더의 값이 아니라 요청이 끝난 지금의 상태로 판단한다.
      setErrorMessage(isServerUnready() ? SERVER_PREPARING_MESSAGE : INVALID_CREDENTIALS_MESSAGE);
      setIsSubmitting(false);
    }
  }

  if (mfaToken) return (
    <AuthScreen shellModifier="login" title="다단계 인증">
      <MfaLoginForm token={mfaToken} onCancel={() => { setMfaToken(null); setErrorMessage(null); }} />
    </AuthScreen>
  );

  return (
    <AuthScreen extra={<SocialLoginButtons />} shellModifier="login" title="로그인">
      <form className="auth-form" method="post" onSubmit={handleLogin}>
        <div className="auth-field-stack">
          {isAccessCodeVisible && !hasOAuthParams ? (
            <div className="auth-field-with-error">
              <AuthField
                autoComplete="off"
                describedBy={accessCodeError ? ACCESS_CODE_ERROR_ID : undefined}
                invalid={Boolean(accessCodeError)}
                label="접근 코드"
                name="access-code"
                onBlur={() => void handleAccessCodeBlur()}
                onChange={(event) => {
                  setAccessCode(event.target.value);
                  setAccessCodeError(null);
                }}
                placeholder="접근 코드가 있으면 입력해 주세요"
                readOnly={isAccessCodeVerified}
                required={false}
                value={accessCode}
              />
              {accessCodeError ? <AuthError id={ACCESS_CODE_ERROR_ID}>{accessCodeError}</AuthError> : null}
              {isAccessCodeVerified ? <p className="auth-prompt" role="status">접근 코드가 확인됐어요.</p> : null}
            </div>
          ) : null}
          <AuthField
            autoComplete="email"
            label="이메일"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="example@email.com"
            type="email"
            value={email}
          />
          <div className="auth-field-with-error">
            <AuthField
              autoComplete="current-password"
              label="비밀번호"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="password"
              type="password"
              value={password}
            />
            {errorMessage ? <AuthError>{errorMessage}</AuthError> : null}
          </div>
        </div>
        <AuthSubmitButton disabled={isSubmitting}>로그인</AuthSubmitButton>
        {isPreparing ? <p className="auth-prompt auth-prompt--wrap" role="status">서버를 준비하고 있어요. 수 분 걸릴 수 있어요.</p> : null}
        {isWakeTimedOut ? <p className="auth-prompt auth-prompt--wrap" role="status">서버 준비가 늦어지고 있어요. 잠시 후 다시 시도해 주세요.</p> : null}
      </form>
      <nav aria-label="계정 도움말" className="auth-login-links">
        <button onClick={() => router.push("/forgot-password")} type="button">비밀번호 찾기</button>
        <span />
        <button onClick={() => router.push("/signup")} type="button">회원가입</button>
      </nav>
    </AuthScreen>
  );
}
