"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogIn, RefreshCw, WifiOff } from "lucide-react";
import { clearSessionCache } from "@/entities/chat";
import { fetchMe, useSignOut } from "@/entities/user";
import { createWorkspace, fetchWorkspaces } from "@/entities/workspace";
import { setSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { clearWorkspaceGone } from "@/shared/lib/workspaceAccess";
import { getErrorMessage, LoginRequiredError, SessionExpiredError } from "@/shared/lib/apiErrors";
import { LoadingOverlay } from "@/shared/ui/LoadingOverlay";
import styles from "./WorkspacesPage.module.css";

export default function WorkspacesPage() {
  const router = useRouter();
  const t = useTranslations("workspace.workspacesPage");
  const tShared = useTranslations("shared");
  const { signOut } = useSignOut();
  const hasStarted = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const prepareWorkspace = useCallback(async () => {
    setErrorMessage(null);
    try {
      await fetchMe();
      const response = await fetchWorkspaces();
      const workspace = response.workspaces?.[0] ?? await createWorkspace(t("defaultName"));
      clearSessionCache();
      setSelectedWorkspaceId(workspace.id);
      clearWorkspaceGone(workspace.id);
      router.replace("/home");
    } catch (error: unknown) {
      if (error instanceof SessionExpiredError || error instanceof LoginRequiredError) {
        void signOut();
        return;
      }
      setErrorMessage(getErrorMessage(error, t("prepareFailed"), tShared));
    }
  }, [router, signOut, t, tShared]);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    void prepareWorkspace();
  }, [prepareWorkspace]);

  if (!errorMessage) return <LoadingOverlay message={t("preparing")} />;

  return (
    <main className={styles["error-screen"]}>
      <section className={styles["error-card"]} aria-labelledby="workspace-error-title">
        <div className={styles["error-icon"]} aria-hidden>
          <WifiOff size={28} strokeWidth={1.8} />
        </div>
        <p className={styles["error-eyebrow"]}>{t("eyebrow")}</p>
        <h1 id="workspace-error-title">{t("title")}</h1>
        <p className={styles["error-description"]}>{t("description")}</p>
        <p className={styles["error-detail"]} role="alert">{errorMessage}</p>

        <div className={styles["error-actions"]}>
          <button
            type="button"
            className={styles["retry-button"]}
            onClick={() => void prepareWorkspace()}
          >
            <RefreshCw size={16} aria-hidden />
            {t("retry")}
          </button>
          <button
            type="button"
            className={styles["login-button"]}
            onClick={() => router.replace("/login")}
          >
            <LogIn size={16} aria-hidden />
            {t("toLogin")}
          </button>
        </div>
      </section>

      <p className={styles["error-support"]}>{t("support")}</p>
    </main>
  );
}
