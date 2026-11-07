"use client";

import { ChevronRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { clearSessionCache } from "@/entities/chat";
import {
  AccountDeletionBlockedError,
  accountDeletionErrorMessage,
  accountDeletionVerification,
  buildAccountDeletionBody,
  deleteAccount,
  getOAuthAuthorizationUrl,
  isReauthenticationRequired,
  oauthProviderName,
  type OAuthProvider,
  type SoleOwnerWorkspace,
  type UserMeResponse
} from "@/entities/user";
import { clearAuth, clearFruitionStorage, setAfterLoginPath } from "@/shared/lib/authSessionStorage";
import { cx } from "@/shared/lib/classNames";
import { saveSettingsResume } from "../../lib/settingsResume";
import { useMfaRequirement } from "../../model/useMfaRequirement";
import styles from "./AccountFlowModal.module.css";
import { AccountFlowModal } from "./AccountFlowModal";

type Step = "notice" | "confirm";

/**
 * 회원 탈퇴 2단계 모달. 안내(지워지는 것·남는 것·내보내기) → 본인 확인 후 DELETE /api/auth/me.
 * 비밀번호 계정은 비밀번호, 비밀번호가 없는 소셜 계정은 10분 안의 소셜 재로그인으로 확인한다. MFA를 켰으면 코드도 받는다.
 * 어느 쪽인지는 me.has_password로 정하고, 필드가 없는 구 서버면 두 방법을 함께 보인다(accountDeletionVerification).
 * 유일한 OWNER로 거절(409)되면 넘겨야 할 워크스페이스 목록을 보여 주고 멤버 관리로 보낸다.
 */
export function AccountDeleteModal({
  me,
  initialStep = "notice",
  onOpenMembers,
  onClose
}: {
  me: UserMeResponse;
  /** 소셜 재로그인에서 돌아오면 확인 단계부터 다시 연다. */
  initialStep?: Step;
  onOpenMembers: (workspaceId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("settings");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isMfaEnabled, requireMfa } = useMfaRequirement();
  const [step, setStep] = useState<Step>(initialStep);
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [blockedWorkspaces, setBlockedWorkspaces] = useState<SoleOwnerWorkspace[] | null>(null);
  const linkedProviders = (me.oauth_providers ?? []) as OAuthProvider[];
  // 비밀번호 계정은 비밀번호, 비밀번호 없는 소셜 계정은 소셜 재로그인만 본다. 구 서버(has_password 없음)는 둘 다 보인다.
  const verification = accountDeletionVerification(me);

  async function submitDeletion() {
    setBusy(true);
    setError(null);
    setBlockedWorkspaces(null);
    try {
      await deleteAccount(buildAccountDeletionBody({ password: verification.showPassword ? password : "", mfaCode }));
      // 계정이 사라졌으니 세션·캐시·fruition.* 저장소를 모두 비우고 로그인 화면에서 완료를 알린다.
      clearSessionCache();
      queryClient.clear();
      clearAuth();
      clearFruitionStorage();
      router.replace("/login?deleted=1");
    } catch (cause: unknown) {
      if (cause instanceof AccountDeletionBlockedError) setBlockedWorkspaces(cause.workspaces);
      setNeedsReauth(isReauthenticationRequired(cause));
      // MFA 상태를 못 읽었거나 낡아 코드 칸이 숨어 있었어도, 서버가 코드를 요구하면 칸을 보이고 다시 받는다.
      if ((cause as { code?: unknown } | null)?.code === "INVALID_MFA_CODE") {
        setMfaCode("");
        requireMfa();
      }
      setError(accountDeletionErrorMessage(cause, t("accountDelete.failed")));
      setBusy(false);
    }
  }

  /** 비밀번호가 없는 소셜 계정의 본인 확인. 로그인을 마치면 설정의 탈퇴 확인 단계로 돌아온다. */
  function reloginWith(provider: OAuthProvider) {
    saveSettingsResume("account-delete");
    setAfterLoginPath(`${window.location.pathname}${window.location.search}`);
    window.location.assign(getOAuthAuthorizationUrl(provider));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (step === "notice") setStep("confirm");
    else void submitDeletion();
  }

  const canSubmit = !busy && (step === "notice" || (
    (!verification.requirePassword || password.trim().length > 0) && (!isMfaEnabled || mfaCode.trim().length > 0)
  ));

  return (
    <AccountFlowModal
      title={t("accountDelete.title")}
      subtitle={step === "notice" ? t("accountDelete.noticeSubtitle") : t("accountDelete.confirmSubtitle")}
      ariaLabel={t("accountDelete.title")}
      canClose={!busy}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {step === "notice" && (
        <div className={styles.fields}>
          <div className={styles.field}>
            <strong>{t("accountDelete.deletedTitle")}</strong>
            <ul className={styles["notice-list"]}>
              <li>{t("accountDelete.deletedAccount")}</li>
              <li>{t("accountDelete.deletedWorkspaces")}</li>
            </ul>
          </div>
          <div className={styles.field}>
            <strong>{t("accountDelete.keptTitle")}</strong>
            <ul className={styles["notice-list"]}>
              <li>{t("accountDelete.keptDocuments")}</li>
            </ul>
          </div>
          <p className={styles.hint}>
            {t("accountDelete.exportHint")}
          </p>
        </div>
      )}

      {step === "confirm" && (
        <div className={styles.fields}>
          {verification.showPassword && (
            <div className={styles.field}>
              <div className={styles["field-head"]}>
                <label htmlFor="account-delete-password">{t("accountDelete.passwordLabel")}</label>
                {verification.showSocialPasswordHint && (
                  <p className={styles["field-desc"]}>{t("accountDelete.socialPasswordHint")}</p>
                )}
              </div>
              <input
                id="account-delete-password"
                type="password"
                autoComplete="current-password"
                placeholder="password"
                autoFocus
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          )}
          {isMfaEnabled && (
            <div className={styles.field}>
              <label htmlFor="account-delete-mfa">{t("common.mfaCodeLabel")}</label>
              <input
                id="account-delete-mfa"
                autoComplete="one-time-code"
                maxLength={64}
                placeholder="XXXXXX"
                value={mfaCode}
                disabled={busy}
                onChange={(event) => setMfaCode(event.target.value)}
              />
            </div>
          )}
          {verification.showSocialRelogin && (
            <div className={styles.field}>
              <p className={styles["field-desc"]}>
                {needsReauth ? t("accountDelete.reauthNeeded") : t("accountDelete.reauthOption")}
              </p>
              <div className={styles["provider-row"]}>
                {linkedProviders.map((provider) => (
                  <button key={provider} type="button" className={styles["btn-back"]} disabled={busy} onClick={() => reloginWith(provider)}>
                    {t("common.reloginWith", { provider: oauthProviderName(provider) })}
                  </button>
                ))}
              </div>
            </div>
          )}
          {blockedWorkspaces && blockedWorkspaces.length > 0 && (
            <div className={styles.field}>
              <p className={styles["field-desc"]}>{t("accountDelete.blockedTitle")}</p>
              <ul className={styles["notice-list"]}>
                {blockedWorkspaces.map((workspace) => (
                  <li key={workspace.id} className={styles["notice-row"]}>
                    <span>{workspace.name}</span>
                    <button type="button" className={styles["btn-back"]} disabled={busy} onClick={() => onOpenMembers(workspace.id)}>
                      {t("accountDelete.openMembers")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
      )}

      <div className={cx(styles.footer, step === "notice" && styles["is-end"])}>
        {step === "confirm" && (
          <button type="button" className={styles["btn-back"]} disabled={busy} onClick={() => { setStep("notice"); setError(null); }}>
            {t("common.back")}
          </button>
        )}
        <button type="submit" className={cx(styles["btn-next"], step === "confirm" && styles["is-danger"])} disabled={!canSubmit}>
          {busy ? t("accountDelete.deleting") : step === "notice" ? t("accountDelete.continue") : t("accountDelete.submit")}
          {!busy && step === "notice" && <ChevronRight size={10} strokeWidth={2.5} aria-hidden />}
        </button>
      </div>
    </AccountFlowModal>
  );
}
