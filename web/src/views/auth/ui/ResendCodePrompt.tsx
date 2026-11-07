"use client";

import { useTranslations } from "next-intl";

type ResendCodePromptProps = {
  disabled: boolean;
  isResending: boolean;
  onResend: () => void;
};

// 인증번호 미수신 안내 문구와 재요청 버튼
export function ResendCodePrompt({ disabled, isResending, onResend }: ResendCodePromptProps) {
  const t = useTranslations("auth.verification");
  return (
    <p className="auth-prompt">
      {t("notReceived")}
      <button disabled={disabled} onClick={onResend} type="button">
        {isResending ? t("resending") : t("resend")}
      </button>
    </p>
  );
}
