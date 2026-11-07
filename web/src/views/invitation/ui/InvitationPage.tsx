"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useSignOut } from "@/entities/user";
import { acceptInvitation, fetchInvitation } from "@/entities/workspace/api/invitations";
import { clearAuth, setAfterLoginPath, setSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { clearWorkspaceGone } from "@/shared/lib/workspaceAccess";
import styles from "@/views/workspaces/ui/WorkspacesPage.module.css";

export default function InvitationPage({ token }: { token: string }) {
  const t = useTranslations("invitation");
  const tShared = useTranslations("shared");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const { signOut } = useSignOut();
  const { data: invitation, error: loadError, isPending } = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => fetchInvitation(token),
    retry: false
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // 다른 탭에서 로그인한 계정을 현재 refresh 쿠키로 다시 확인한다.
      clearAuth();
      queryClient.clear();
      const accepted = await acceptInvitation(token);
      setSelectedWorkspaceId(accepted.workspace_id);
      // 내보내졌던 워크스페이스에 다시 초대받았으면 이 탭에 남은 접근 불가 기록을 지운다.
      clearWorkspaceGone(accepted.workspace_id);
      window.location.assign("/home");
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, t("acceptFailed"), tShared));
    } finally {
      setBusy(false);
    }
  }

  // 다른 계정의 세션이 남아 있으면 /login이 곧장 /workspaces로 보내므로 먼저 로그아웃한다.
  async function loginAsInvitee() {
    if (busy) return;
    setBusy(true);
    setAfterLoginPath(window.location.pathname);
    await signOut({ callLogout: true });
  }

  return (
    <main className={styles["error-screen"]}>
      <section className={styles["error-card"]} aria-labelledby="invitation-title">
        <h1 id="invitation-title">{t("title")}</h1>
        {isPending && <p role="status">{t("loading")}</p>}
        {invitation && <>
          <p className={styles["error-description"]}>{t("invitedBy", { inviter: invitation.invited_by, workspace: invitation.workspace_name })}</p>
          <p>{t("loginAs", { email: invitation.email })}</p>
          <p>{t("details", {
            role: invitation.role === "OWNER" ? t("roles.owner") : t("roles.member"),
            expiresAt: format.dateTime(new Date(invitation.expires_at), { dateStyle: "medium", timeStyle: "short" })
          })}</p>
          <div className={styles["error-actions"]}>
            <button type="button" className={styles["retry-button"]} disabled={busy} onClick={() => void accept()}>{busy ? t("accepting") : t("accept")}</button>
            <button type="button" className={styles["login-button"]} disabled={busy} onClick={() => void loginAsInvitee()}>{t("loginAsInvitee")}</button>
          </div>
          <p className={styles["error-support"]}>{t("returnNotice")}</p>
        </>}
        {(error || loadError) && <p className={styles["error-detail"]} role="alert">{error || getErrorMessage(loadError, t("loadFailed"), tShared)}</p>}
      </section>
    </main>
  );
}
