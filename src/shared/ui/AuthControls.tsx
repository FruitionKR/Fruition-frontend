"use client";

import Image from "next/image";
import { useState } from "react";
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
            aria-label={isPasswordRevealed ? "비밀번호 숨기기" : "비밀번호 표시"}
            aria-pressed={isPasswordRevealed}
            className="auth-password-toggle"
            onClick={() => setIsPasswordRevealed((revealed) => !revealed)}
            type="button"
          >
            <Image
              alt=""
              aria-hidden
              className="auth-password-icon"
              src={isPasswordRevealed ? passwordVisibleIcon : passwordHiddenIcon}
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

export function AuthSubmitButton({ children, disabled = false }: { children: string; disabled?: boolean }) {
  return (
    <button className="auth-submit" disabled={disabled} type="submit">
      {children}
    </button>
  );
}

export function SocialLoginButtons() {
  const providers = [
    { name: "카카오", provider: "kakao", logo: kakaoLogo },
    { name: "네이버", provider: "naver", logo: naverLogo },
    { name: "Google", provider: "google", logo: googleLogo }
  ] as const;

  return (
    <div className="auth-social">
      <div className="auth-social-divider">
        <span />
        <p>간편 로그인</p>
        <span />
      </div>
      <div className="auth-social-buttons">
        {providers.map(({ logo, name, provider }) => (
          <button
            aria-label={`${name}로 로그인`}
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
