"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/** 회원가입·비밀번호 재설정 화면 아래의 로그인 화면 안내. */
export function LoginLinkPrompt() {
  const router = useRouter();
  const t = useTranslations("auth.loginLink");
  return (
    <p className="auth-prompt">{t("prompt")}<button onClick={() => router.push("/login")} type="button">{t("action")}</button></p>
  );
}
