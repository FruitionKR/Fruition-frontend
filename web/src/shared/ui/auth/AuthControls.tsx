"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import type { ChangeEventHandler, FocusEventHandler, HTMLInputAutoCompleteAttribute, HTMLInputTypeAttribute } from "react";
import errorIcon from "@/shared/assets/svg/auth/auth-error-circle.svg";
import googleLogo from "@/shared/assets/svg/auth/auth-google-logo.svg";
import kakaoLogo from "@/shared/assets/svg/auth/auth-kakao-logo.svg";
import naverLogo from "@/shared/assets/svg/auth/auth-naver-logo.svg";
import passwordHiddenIcon from "@/shared/assets/svg/auth/auth-password-hidden.svg";
import passwordVisibleIcon from "@/shared/assets/svg/auth/auth-password-visible.svg";
import { getOAuthAuthorizationUrl } from "@/entities/user";

type AuthFieldProps = {
  autoComplete?: HTMLInputAutoCompleteAttribute;
  /** 입력과 연결할 오류·안내 문구의 id */
  describedBy?: string;
  invalid?: boolean;
  label: string;
  name: string;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder: string;
  readOnly?: boolean;
  required?: boolean;
  timer?: string;
  type?: HTMLInputTypeAttribute;
  value: string;
};

export function AuthField({
  autoComplete,
  describedBy,
  invalid,
  label,
  name,
  onBlur,
  onChange,
  placeholder,
  readOnly = false,
  required = true,
  timer,
  type = "text",
  value
}: AuthFieldProps) {
  const t = useTranslations("auth.controls");
  const isPassword = type === "password";
  const [isPasswordRevealed, setIsPasswordRevealed] = useState(false);
  const inputType = isPassword && isPasswordRevealed ? "text" : type;

  return (
    <label className="auth-field">
      <span>{label}</span>
      <span className={timer || isPassword ? "auth-field-control has-adornment" : "auth-field-control"}>
        <input
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          autoComplete={autoComplete}
          name={name}
          onBlur={onBlur}
          onChange={onChange}
          placeholder={placeholder}
          readOnly={readOnly}
          required={required}
          type={inputType}
          value={value}
        />
        {timer ? <span aria-hidden className="auth-field-timer">{timer}</span> : null}
        {isPassword ? (
          <button
            aria-label={isPasswordRevealed ? t("hidePassword") : t("showPassword")}
            aria-pressed={isPasswordRevealed}
            className="auth-password-toggle"
            onClick={() => setIsPasswordRevealed((revealed) => !revealed)}
            type="button"
          >
            {/* 테마별 아이콘 색을 CSS 토큰으로 바꾸기 위해 SVG를 mask로 그린다. */}
            <span
              aria-hidden
              className="auth-password-icon"
              style={{
                maskImage: `url(${(isPasswordRevealed ? passwordVisibleIcon : passwordHiddenIcon).src})`
              }}
            />
          </button>
        ) : null}
      </span>
    </label>
  );
}

export function AuthError({ children, id }: { children: string; id?: string }) {
  return (
    <p className="auth-error" id={id} role="alert">
      <Image alt="" aria-hidden src={errorIcon} />
      <span>{children}</span>
    </p>
  );
}

const subscribeNothing = () => () => undefined;

/**
 * 제출 버튼. 화면을 내려받았지만 스크립트가 붙기 전에는 막는다. 이때 누르면 브라우저가 폼을 POST해 입력만 지워지고
 * 로그인되지 않은 채 같은 화면으로 돌아온다. 기본 버튼이 막히면 Enter 제출도 함께 막힌다.
 */
export function AuthSubmitButton({ children, disabled = false }: { children: string; disabled?: boolean }) {
  const isHydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return (
    <button className="auth-submit" disabled={disabled || !isHydrated} type="submit">
      {children}
    </button>
  );
}

export function SocialLoginButtons() {
  const t = useTranslations("auth.controls");
  const providers = [
    { provider: "kakao", logo: kakaoLogo },
    { provider: "naver", logo: naverLogo },
    { provider: "google", logo: googleLogo }
  ] as const;

  return (
    <div className="auth-social">
      <div className="auth-social-divider">
        <span />
        <p>{t("socialDivider")}</p>
        <span />
      </div>
      <div className="auth-social-buttons">
        {providers.map(({ logo, provider }) => (
          <button
            aria-label={t("socialLogin", { provider: t(`providers.${provider}`) })}
            className={`auth-social-button auth-social-button--${provider}`}
            key={provider}
            onClick={() => window.location.assign(getOAuthAuthorizationUrl(provider))}
            type="button"
          >
            <Image alt="" aria-hidden src={logo} />
          </button>
        ))}
      </div>
    </div>
  );
}
