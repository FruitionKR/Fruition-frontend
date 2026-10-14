"use client";

import { ChevronRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clearSessionCache } from "@/entities/chat";
import {
  AccountDeletionBlockedError,
  accountDeletionErrorMessage,
  buildAccountDeletionBody,
  deleteAccount,
  fetchMfaStatus,
  getOAuthAuthorizationUrl,
  isReauthenticationRequired,
  MFA_QUERY_KEY,
  oauthProviderName,
  type OAuthProvider,
  type SoleOwnerWorkspace,
  type UserMeResponse
} from "@/entities/user";
import { clearAuth, clearFruitionStorage, setAfterLoginPath } from "@/shared/lib/authSessionStorage";
import { cx } from "@/shared/lib/classNames";
import { saveSettingsResume } from "../../lib/settingsResume";
import styles from "./AccountFlowModal.module.css";
import { AccountFlowModal } from "./AccountFlowModal";

type Step = "notice" | "confirm";

/**
 * 회원 탈퇴 2단계 모달. 안내(지워지는 것·남는 것·내보내기) → 본인 확인 후 DELETE /api/auth/me.
 * 비밀번호 계정은 비밀번호, 비밀번호가 없는 소셜 계정은 10분 안의 소셜 재로그인으로 확인한다. MFA를 켰으면 코드도 받는다.
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: mfaStatus } = useQuery({ queryKey: MFA_QUERY_KEY, queryFn: fetchMfaStatus, retry: false });
  const [step, setStep] = useState<Step>(initialStep);
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [blockedWorkspaces, setBlockedWorkspaces] = useState<SoleOwnerWorkspace[] | null>(null);
  const linkedProviders = (me.oauth_providers ?? []) as OAuthProvider[];
  const isMfaEnabled = mfaStatus?.enabled === true;

  async function submitDeletion() {
    setBusy(true);
    setError(null);
    setBlockedWorkspaces(null);
    try {
      await deleteAccount(buildAccountDeletionBody({ password, mfaCode }));
      // 계정이 사라졌으니 세션·캐시·fruition.* 저장소를 모두 비우고 로그인 화면에서 완료를 알린다.
      clearSessionCache();
      queryClient.clear();
      clearAuth();
      clearFruitionStorage();
      router.replace("/login?deleted=1");
    } catch (cause: unknown) {
      if (cause instanceof AccountDeletionBlockedError) setBlockedWorkspaces(cause.workspaces);
      setNeedsReauth(isReauthenticationRequired(cause));
      setError(accountDeletionErrorMessage(cause, "회원 탈퇴에 실패했습니다."));
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

  const canSubmit = !busy && (step === "notice" || (!isMfaEnabled || mfaCode.trim().length > 0));

  return (
    <AccountFlowModal
      title="회원 탈퇴"
      subtitle={step === "notice"
        ? "탈퇴하면 계정과 혼자 쓰던 워크스페이스가 삭제됩니다. 아래 내용을 확인해 주세요."
        : "본인 확인 후 바로 탈퇴가 진행됩니다. 되돌릴 수 없습니다."}
      ariaLabel="회원 탈퇴"
      canClose={!busy}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {step === "notice" && (
        <div className={styles.fields}>
          <div className={styles.field}>
            <strong>삭제되는 것</strong>
            <ul className={styles["notice-list"]}>
              <li>계정 정보(이메일, 닉네임, 로그인 수단, 다단계 인증)</li>
              <li>혼자 쓰던 워크스페이스와 그 안의 문서·위키·채팅·회의 녹음</li>
            </ul>
          </div>
          <div className={styles.field}>
            <strong>남는 것</strong>
            <ul className={styles["notice-list"]}>
              <li>다른 멤버가 있는 워크스페이스에 올린 문서와 위키 (작성자 표시만 지워집니다)</li>
            </ul>
          </div>
          <p className={styles.hint}>
            보관할 자료가 있으면 탈퇴 전에 워크스페이스의 위키 내보내기로 먼저 받아 두세요. 탈퇴 뒤에는 복구할 수 없습니다.
            다른 멤버가 있는 워크스페이스의 유일한 OWNER라면 먼저 다른 멤버에게 OWNER를 넘겨야 합니다.
          </p>
        </div>
      )}

      {step === "confirm" && (
        <div className={styles.fields}>
          <div className={styles.field}>
            <div className={styles["field-head"]}>
              <label htmlFor="account-delete-password">비밀번호</label>
              {linkedProviders.length > 0 && (
                <p className={styles["field-desc"]}>비밀번호 없이 소셜 계정으로만 로그인하는 경우 비워 두고 아래에서 다시 로그인해 확인해 주세요.</p>
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
          {isMfaEnabled && (
            <div className={styles.field}>
              <label htmlFor="account-delete-mfa">인증 코드 또는 복구 코드</label>
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
          {linkedProviders.length > 0 && (
            <div className={styles.field}>
              <p className={styles["field-desc"]}>
                {needsReauth ? "소셜 계정으로 다시 로그인하면 이 화면으로 돌아옵니다. 10분 안에 탈퇴를 완료해 주세요." : "소셜 계정으로 본인 확인"}
              </p>
              <div className={styles["provider-row"]}>
                {linkedProviders.map((provider) => (
                  <button key={provider} type="button" className={styles["btn-back"]} disabled={busy} onClick={() => reloginWith(provider)}>
                    {oauthProviderName(provider)}로 다시 로그인
                  </button>
                ))}
              </div>
            </div>
          )}
          {blockedWorkspaces && blockedWorkspaces.length > 0 && (
            <div className={styles.field}>
              <p className={styles["field-desc"]}>다른 멤버에게 OWNER를 넘겨야 하는 워크스페이스</p>
              <ul className={styles["notice-list"]}>
                {blockedWorkspaces.map((workspace) => (
                  <li key={workspace.id} className={styles["notice-row"]}>
                    <span>{workspace.name}</span>
                    <button type="button" className={styles["btn-back"]} disabled={busy} onClick={() => onOpenMembers(workspace.id)}>
                      멤버 관리로 이동
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
            이전
          </button>
        )}
        <button type="submit" className={cx(styles["btn-next"], step === "confirm" && styles["is-danger"])} disabled={!canSubmit}>
          {busy ? "탈퇴 중…" : step === "notice" ? "계속" : "탈퇴하기"}
          {!busy && step === "notice" && <ChevronRight size={10} strokeWidth={2.5} aria-hidden />}
        </button>
      </div>
    </AccountFlowModal>
  );
}
