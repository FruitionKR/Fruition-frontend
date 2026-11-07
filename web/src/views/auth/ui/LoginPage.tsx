"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  confirmOAuthLink,
  exchangeOAuthCode,
  loginWithEmail,
  ME_QUERY_KEY,
  OAUTH_LINK_FAILED_MESSAGE,
  OAUTH_LINK_SUCCESS_MESSAGE,
  OAUTH_LOGIN_FAILED_MESSAGE,
  oauthAccountErrorMessage,
  oauthCallbackErrorMessage,
  parseOAuthCallbackError,
  parseOAuthLinkCallback,
  parseOAuthSignupToken,
  saveOAuthLinkResult,
  useMe,
  type OAuthLinkCallback,
  type OAuthLinkResult
} from "@/entities/user";
import { useTypedFormValues } from "@/shared/hooks/useTypedFormValues";
import { saveAccessToken, takeAfterLoginPath } from "@/shared/lib/authSessionStorage";
import { hasHangul } from "@/shared/lib/passwordPolicy";
import { AuthError, AuthField, AuthSubmitButton, SocialLoginButtons } from "@/shared/ui/auth/AuthControls";
import { AuthScreen, AuthScreenBlank } from "@/shared/ui/auth/AuthScreen";
import { MfaLoginForm } from "@/views/auth/ui/MfaLoginForm";
import { useOAuthCallbackGate } from "@/views/auth/model/useOAuthCallbackGate";
import { useServerWake, type AccessCodeResult } from "@/views/auth/model/useServerWake";
import { getLoginErrorMessage } from "@/views/auth/lib/loginErrorMessage";
import { OAuthSignupConsentForm } from "@/views/auth/ui/OAuthSignupConsentForm";

const ACCESS_CODE_ERROR_ID = "login-access-code-error";
const PASSWORD_HANGUL_WARNING_ID = "login-password-hangul-warning";
type AccessCodeErrorKey = "empty" | "invalid" | "error" | "rateLimited";
// 접근 코드 확인 결과 → auth.accessCodeErrors 키
const ACCESS_CODE_ERROR_KEYS: Record<Exclude<AccessCodeResult, "ok"> | "empty", AccessCodeErrorKey> = {
  empty: "empty",
  invalid: "invalid",
  error: "error",
  "rate-limited": "rateLimited"
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
  const t = useTranslations("auth");
  const hasHandledOAuth = useRef(false);
  const isLoginRequestInFlight = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  // 소셜 신규 가입: 계정이 아직 없고 동의를 받아야 만들어진다. 콜백 query에서 한 번 읽어 상태로 들고 간다.
  const [signupToken, setSignupToken] = useState<string | null>(null);
  // 탈퇴 직후 로그인 화면으로 돌아오면 완료 안내를 보여 준다. query는 처리하며 주소에서 지운다.
  const [isAccountDeleted] = useState(() => searchParams.get("deleted") === "1");
  const [accessCode, setAccessCode] = useState("");
  const [accessCodeError, setAccessCodeError] = useState<AccessCodeErrorKey | null>(null);
  const {
    isPreparing,
    isWakeTimedOut,
    isAccessCodeVisible,
    isAccessCodeVerified,
    unlockAccessCode,
    requestBeforeSubmit,
    isServerUnready
  } = useServerWake();
  // 콜백 query는 처리하면서 주소에서 지운다. 지운 뒤에도 세션 확인(useMe)이 code 교환과 겹치지 않게 첫 렌더 값을 유지한다.
  const { isOAuthLinkCallback, hasOAuthParams, canCheckSession, finishOAuthLoginAttempt } = useOAuthCallbackGate(searchParams);
  // refresh 쿠키로 세션이 살아 있으면 로그인 폼 대신 바로 워크스페이스로 보낸다.
  // OAuth 콜백(code/error/signup_token, 연동의 link_code/link)을 처리하는 동안은 그 처리가 우선이라 건너뛴다.
  // 탈퇴 직후는 세션이 없어 /me가 실패만 하므로 묻지 않는다.
  const { isSuccess: isAlreadySignedIn } = useMe({ enabled: canCheckSession && !mfaToken && !signupToken && !isAccountDeleted });

  const formRef = useTypedFormValues({ email: setEmail, password: setPassword });

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

    if (isAccountDeleted) {
      hasHandledOAuth.current = true;
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    // 소셜 계정으로 처음 들어온 사용자. 계정을 만들기 전에 동의 화면을 거친다.
    const pendingSignupToken = parseOAuthSignupToken(searchParams);
    if (pendingSignupToken) {
      hasHandledOAuth.current = true;
      window.history.replaceState({}, "", window.location.pathname);
      setSignupToken(pendingSignupToken);
      return;
    }

    // 설정에서 시작한 소셜 계정 연동의 콜백. 로그인한 채로 확정한 뒤 연동을 시작한 화면으로 돌아간다.
    const linkCallback = parseOAuthLinkCallback(searchParams);
    if (linkCallback) {
      hasHandledOAuth.current = true;
      window.history.replaceState({}, "", window.location.pathname);
      finishOAuthLink(linkCallback, t("login.oauthLinkFailed"))
        .then((result) => {
          saveOAuthLinkResult(result);
          void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
          router.replace(takeAfterLoginPath());
        })
        // finishOAuthLink는 연동 실패를 결과로 돌려주므로, 여기 오는 건 결과 저장(sessionStorage) 등 후처리 실패다.
        .catch((error: unknown) => {
          setErrorMessage(oauthAccountErrorMessage(error, t("login.oauthLinkResultFailed")));
        });
      return;
    }

    const code = searchParams.get("code");
    const callbackError = parseOAuthCallbackError(searchParams);
    if (!code && !callbackError) return;

    hasHandledOAuth.current = true;
    window.history.replaceState({}, "", window.location.pathname);

    // error=email_registered&providers=local,google: 같은 이메일의 계정이 있어 가입을 거절한 콜백.
    // 그 계정의 로그인 수단(이메일 또는 소셜)으로 로그인한 뒤 설정에서 연동하도록 안내한다(access #31).
    if (callbackError) {
      setErrorMessage(oauthCallbackErrorMessage(callbackError));
      return;
    }

    setIsSubmitting(true);
    exchangeOAuthCode(code as string)
      .then((tokens) => {
        if (tokens.mfa_required) {
          finishOAuthLoginAttempt();
          setMfaToken(tokens.mfa_token);
          setIsSubmitting(false);
          return;
        }
        saveAccessToken(tokens.access_token);
        queryClient.clear();
        router.replace(takeAfterLoginPath());
      })
      .catch(() => {
        finishOAuthLoginAttempt();
        setErrorMessage(OAUTH_LOGIN_FAILED_MESSAGE);
        setIsSubmitting(false);
      });
  }, [finishOAuthLoginAttempt, isAccountDeleted, queryClient, router, searchParams, t]);

  // 칸을 벗어나면 바로 확인해, 이메일·비밀번호를 입력하는 동안 서버 기동이 시작되게 한다.
  async function handleAccessCodeBlur() {
    if (isAccessCodeVerified || !accessCode.trim()) return;
    const result = await unlockAccessCode(accessCode);
    setAccessCodeError(result === "ok" ? null : ACCESS_CODE_ERROR_KEYS[result]);
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting || isLoginRequestInFlight.current) return;

    isLoginRequestInFlight.current = true;
    setErrorMessage(null);
    setIsSubmitting(true);

    // 접근 코드 게이트가 켜져 있으면 코드가 확인되기 전에는 로그인하지 않는다(서비스 사용 불가).
    if (isAccessCodeVisible && !isAccessCodeVerified) {
      const result = accessCode.trim() ? await unlockAccessCode(accessCode) : "empty";
      if (result !== "ok") {
        setAccessCodeError(ACCESS_CODE_ERROR_KEYS[result]);
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
    } catch (error: unknown) {
      isLoginRequestInFlight.current = false;
      // 서버 준비 중의 실패는 자격 증명 문제가 아니다. 자동 재전송하지 않고 사용자가 다시 누르게 한다.
      // 제출 시점 렌더의 값이 아니라 요청이 끝난 지금의 상태로 판단한다.
      setErrorMessage(getLoginErrorMessage(error, isServerUnready(), (key) => t(`loginErrors.${key}`)));
      setIsSubmitting(false);
    }
  }

  // 연동 확정은 곧바로 설정 화면으로 돌아가므로 로그인 폼을 잠깐이라도 보이지 않는다.
  if (isOAuthLinkCallback) return <AuthScreenBlank />;

  if (mfaToken) return (
    <AuthScreen shellModifier="login" title={t("mfa.title")}>
      <MfaLoginForm token={mfaToken} onCancel={() => { setMfaToken(null); setErrorMessage(null); }} />
    </AuthScreen>
  );

  if (signupToken) return (
    <AuthScreen shellModifier="verification" title={t("oauthSignup.title")}>
      <OAuthSignupConsentForm
        signupToken={signupToken}
        onMfaRequired={(token) => { setSignupToken(null); setMfaToken(token); }}
        onRestart={() => setSignupToken(null)}
      />
    </AuthScreen>
  );

  return (
    <AuthScreen extra={<SocialLoginButtons disabled={isAccessCodeVisible && !isAccessCodeVerified} />} shellModifier="login" title={t("login.title")}>
      <form className="auth-form" method="post" onSubmit={handleLogin} ref={formRef}>
        <div className="auth-field-stack">
          {isAccessCodeVisible && !hasOAuthParams ? (
            <div className="auth-field-with-error">
              <AuthField
                autoComplete="off"
                describedBy={accessCodeError ? ACCESS_CODE_ERROR_ID : undefined}
                invalid={Boolean(accessCodeError)}
                label={t("login.accessCodeLabel")}
                name="access-code"
                onBlur={() => void handleAccessCodeBlur()}
                onChange={(event) => {
                  setAccessCode(event.target.value);
                  setAccessCodeError(null);
                }}
                placeholder={t("login.accessCodePlaceholder")}
                readOnly={isAccessCodeVerified}
                // 빈 값도 handleLogin에서 칸 아래 문구로 알리도록 브라우저 기본 검증은 쓰지 않는다.
                required={false}
                value={accessCode}
              />
              {accessCodeError ? <AuthError id={ACCESS_CODE_ERROR_ID}>{t(`accessCodeErrors.${accessCodeError}`)}</AuthError> : null}
              {isAccessCodeVerified ? <p className="auth-prompt" role="status">{t("login.accessCodeVerified")}</p> : null}
            </div>
          ) : null}
          <AuthField
            autoComplete="email"
            label={t("fields.email")}
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="example@email.com"
            type="email"
            value={email}
          />
          <div className="auth-field-with-error">
            <AuthField
              autoComplete="current-password"
              describedBy={hasHangul(password) ? PASSWORD_HANGUL_WARNING_ID : undefined}
              label={t("fields.password")}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="password"
              type="password"
              value={password}
            />
            {/* 한글 비밀번호도 허용되므로 막지 않고 한/영 전환 실수만 알린다. */}
            {hasHangul(password) ? (
              <p className="auth-prompt auth-prompt--wrap auth-prompt--warning" id={PASSWORD_HANGUL_WARNING_ID} role="status">
                {t("login.passwordHangulWarning")}
              </p>
            ) : null}
            {errorMessage ? <AuthError>{errorMessage}</AuthError> : null}
          </div>
        </div>
        <AuthSubmitButton disabled={isSubmitting}>{t("login.submit")}</AuthSubmitButton>
        {isAccountDeleted ? <p className="auth-prompt auth-prompt--wrap" role="status">{t("login.accountDeleted")}</p> : null}
        {isPreparing ? <p className="auth-prompt auth-prompt--wrap" role="status">{t("login.serverPreparing")}</p> : null}
        {isWakeTimedOut ? <p className="auth-prompt auth-prompt--wrap" role="status">{t("login.serverWakeTimedOut")}</p> : null}
      </form>
      <nav aria-label={t("login.helpNavLabel")} className="auth-login-links">
        <button onClick={() => router.push("/forgot-password")} type="button">{t("login.forgotPassword")}</button>
        <span />
        <button onClick={() => router.push("/signup")} type="button">{t("login.signup")}</button>
      </nav>
    </AuthScreen>
  );
}

async function finishOAuthLink(callback: OAuthLinkCallback, failedMessage: string): Promise<OAuthLinkResult> {
  if (callback.kind === "failed") return { ok: false, message: OAUTH_LINK_FAILED_MESSAGE };
  try {
    await confirmOAuthLink(callback.linkCode);
    return { ok: true, message: OAUTH_LINK_SUCCESS_MESSAGE };
  } catch (error: unknown) {
    return { ok: false, message: oauthAccountErrorMessage(error, failedMessage) };
  }
}
