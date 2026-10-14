"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { resetPasswordWithVerification } from "@/entities/user";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { getPasswordPolicyError } from "@/shared/lib/passwordPolicy";
import { useAuthFlow } from "@/views/auth/model/AuthFlowContext";
import { AuthError, AuthField, AuthSubmitButton } from "@/shared/ui/auth/AuthControls";
import { AuthScreen, AuthScreenBlank } from "@/shared/ui/auth/AuthScreen";
import { LoginLinkPrompt } from "@/views/auth/ui/LoginLinkPrompt";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { passwordResetDraft } = useAuthFlow();
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const draft = passwordResetDraft;
  const verificationToken = draft?.verificationToken;

  useEffect(() => {
    if (!passwordResetDraft?.verificationToken) router.replace("/forgot-password");
  }, [passwordResetDraft, router]);

  if (!draft || !verificationToken) {
    return <AuthScreenBlank />;
  }

  async function handlePasswordReset(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting || !draft || !verificationToken) return;

    if (password !== passwordConfirmation) {
      setErrorMessage("비밀번호가 일치하지 않습니다.");
      return;
    }
    const passwordError = getPasswordPolicyError(password);
    if (passwordError) {
      setErrorMessage(passwordError);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await resetPasswordWithVerification(
        draft.email,
        password,
        verificationToken
      );
      router.replace("/login");
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "비밀번호 재설정에 실패했습니다."));
      setIsSubmitting(false);
    }
  }

  return (
    <AuthScreen shellModifier="password" title="비밀번호 재설정">
      <form className="auth-form" method="post" onSubmit={handlePasswordReset}>
        <div className="auth-field-with-error">
          <div className="auth-field-stack">
            <AuthField autoComplete="new-password" label="비밀번호" name="password" onChange={(event) => setPassword(event.target.value)} placeholder="password" type="password" value={password} />
            <AuthField autoComplete="new-password" label="비밀번호 재확인" name="passwordConfirmation" onChange={(event) => setPasswordConfirmation(event.target.value)} placeholder="password" type="password" value={passwordConfirmation} />
          </div>
          {errorMessage ? <AuthError>{errorMessage}</AuthError> : null}
        </div>
        <AuthSubmitButton disabled={isSubmitting}>확인</AuthSubmitButton>
      </form>
      <LoginLinkPrompt />
    </AuthScreen>
  );
}
