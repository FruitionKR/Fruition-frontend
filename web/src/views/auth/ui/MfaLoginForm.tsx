"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { loginWithMfa } from "@/entities/user";
import { saveAccessToken, takeAfterLoginPath } from "@/shared/lib/authSessionStorage";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { AuthError, AuthField, AuthSubmitButton } from "@/shared/ui/auth/AuthControls";

export function MfaLoginForm({ token, onCancel }: { token: string; onCancel: () => void }) {
  const router = useRouter();
  const t = useTranslations("auth.mfa");
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const tokens = await loginWithMfa(token, code.trim());
      saveAccessToken(tokens.access_token);
      queryClient.clear();
      setCode("");
      router.replace(takeAfterLoginPath());
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, t("failed")));
      setBusy(false);
    }
  }

  return <>
    <p className="auth-prompt">{t("description")}</p>
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <AuthField label={t("codeLabel")} name="mfaCode" autoComplete="one-time-code"
        placeholder={t("codePlaceholder")} value={code} readOnly={busy} onChange={(event) => setCode(event.target.value)} />
      {error && <AuthError>{error}</AuthError>}
      <AuthSubmitButton disabled={busy || !code.trim()}>{busy ? t("submitting") : t("submit")}</AuthSubmitButton>
    </form>
    <p className="auth-prompt"><button type="button" disabled={busy} onClick={onCancel}>{t("restart")}</button></p>
  </>;
}
