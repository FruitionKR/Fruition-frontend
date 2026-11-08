"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { LoginRequiredError } from "@/shared/lib/apiErrors";
import { setAfterLoginPath } from "@/shared/lib/authSessionStorage";
import { AuthError } from "@/shared/ui/auth/AuthControls";
import { AuthScreen } from "@/shared/ui/auth/AuthScreen";
import {
  McpAuthorizationError,
  authorizationResumePath,
  decideMcpAuthorization,
  isLoopbackHost,
  isPendingExpired,
  previewMcpAuthorization,
  type McpAuthorizationSession,
  type McpPendingAuthorization,
  type McpScope
} from "../api/mcpAuthorization";
import styles from "./McpAuthorizationPage.module.css";

type ErrorKind = "invalid" | "load" | "expired" | "auth" | "decision";

function errorKind(error: unknown): ErrorKind {
  if (error instanceof McpAuthorizationError) {
    if (error.code === "INVALID_QUERY") return "invalid";
    if (error.code === "EXPIRED") return "expired";
    if (error.code === "AUTH_CHANGED") return "auth";
    if (["DECISION_STARTED", "DECISION_FAILED", "UNSAFE_REDIRECT"].includes(error.code)) return "decision";
  }
  return "load";
}

export default function McpAuthorizationPage() {
  const router = useRouter();
  const [session, setSession] = useState<McpAuthorizationSession | null>(null);
  const sessionRef = useRef<McpAuthorizationSession | null>(null);
  const previewRef = useRef<Promise<McpAuthorizationSession> | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    let search: string;
    try {
      search = window.location.search;
      authorizationResumePath(search);
    } catch (error) {
      setFailure(errorKind(error));
      return;
    }
    previewRef.current ??= previewMcpAuthorization(search);
    previewRef.current.then((nextSession) => {
      if (cancelled) return;
      sessionRef.current = nextSession;
      setSession(nextSession);
    }).catch((error: unknown) => {
      if (cancelled) return;
      if (error instanceof LoginRequiredError) {
        setAfterLoginPath(authorizationResumePath(search));
        router.replace("/login");
        return;
      }
      setFailure(errorKind(error));
    });
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    if (!session) return;
    const remaining = Date.parse(session.pending.expires_at) - Date.now();
    if (remaining <= 0) {
      sessionRef.current = null;
      setSession(null);
      setFailure("expired");
      return;
    }
    const timer = window.setTimeout(() => {
      sessionRef.current = null;
      setSession(null);
      setFailure("expired");
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    const invalidate = () => {
      if (!sessionRef.current) return;
      sessionRef.current = null;
      setSession(null);
      setFailure("auth");
    };
    window.addEventListener("fruition:auth-cleared", invalidate);
    return () => window.removeEventListener("fruition:auth-cleared", invalidate);
  }, []);

  async function decide(decision: "APPROVE" | "DENY") {
    const current = sessionRef.current;
    if (!current || busy) return;
    setBusy(true);
    try {
      const redirect = await decideMcpAuthorization(current, decision, selectedWorkspaceId || undefined);
      window.location.assign(redirect);
    } catch (error) {
      sessionRef.current = null;
      setSession(null);
      setFailure(errorKind(error));
    }
  }

  if (failure) return <McpAuthorizationFailure kind={failure} />;
  if (!session) return <McpAuthorizationLoading />;
  return (
    <McpAuthorizationConsent
      busy={busy}
      onApprove={() => void decide("APPROVE")}
      onDeny={() => void decide("DENY")}
      onSelectWorkspace={setSelectedWorkspaceId}
      pending={session.pending}
      selectedWorkspaceId={selectedWorkspaceId}
    />
  );
}

function McpAuthorizationLoading() {
  const t = useTranslations("mcpAuthorization");
  return (
    <AuthScreen shellModifier="verification" title={t("title")}>
      <p aria-live="polite" className="auth-prompt auth-prompt--wrap">{t("loading")}</p>
    </AuthScreen>
  );
}

function McpAuthorizationFailure({ kind }: { kind: ErrorKind }) {
  const t = useTranslations("mcpAuthorization");
  return (
    <AuthScreen shellModifier="verification" title={t("title")}>
      <div className={styles.failure}>
        <AuthError>{t(`errors.${kind}`)}</AuthError>
        <p className="auth-prompt auth-prompt--wrap">{t("restartHint")}</p>
        <button className={styles.secondaryButton} onClick={() => window.location.reload()} type="button">
          {t("restart")}
        </button>
      </div>
    </AuthScreen>
  );
}

export function McpAuthorizationConsent({
  busy,
  onApprove,
  onDeny,
  onSelectWorkspace,
  pending,
  selectedWorkspaceId
}: {
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  pending: McpPendingAuthorization;
  selectedWorkspaceId: string;
}) {
  const t = useTranslations("mcpAuthorization");
  const format = useFormatter();
  const expired = isPendingExpired(pending);
  const clientName = pending.client_name ?? pending.client_id;
  const scopeLabel = (scope: McpScope) => t(`scopes.${scope}`);

  return (
    <AuthScreen shellModifier="verification" title={t("title")}>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); onApprove(); }}>
        <dl className={styles.details}>
          <div><dt>{t("client")}</dt><dd>{clientName}</dd></div>
          <div><dt>{t("redirectHost")}</dt><dd>{pending.redirect_host}</dd></div>
          <div><dt>{t("scopesLabel")}</dt><dd>{pending.scopes.map(scopeLabel).join(", ")}</dd></div>
          <div><dt>{t("expiresAt")}</dt><dd>{format.dateTime(new Date(pending.expires_at), { dateStyle: "medium", timeStyle: "short" })}</dd></div>
        </dl>

        <div className={styles.warnings} role="note">
          <p>{t("identityWarning")}</p>
          {isLoopbackHost(pending.redirect_host) ? <p>{t("loopbackWarning")}</p> : null}
        </div>

        <fieldset className={styles.workspaces}>
          <legend>{t("workspaceLabel")}</legend>
          {pending.workspaces.length === 0 ? <p>{t("noWorkspaces")}</p> : pending.workspaces.map((workspace, index) => {
            const id = `mcp-workspace-${index}`;
            return (
              <label htmlFor={id} key={workspace.workspace_id}>
                <input
                  checked={selectedWorkspaceId === workspace.workspace_id}
                  disabled={busy || expired}
                  id={id}
                  name="workspace"
                  onChange={() => onSelectWorkspace(workspace.workspace_id)}
                  type="radio"
                  value={workspace.workspace_id}
                />
                <span>{workspace.workspace_name}</span>
                <small>{t(`roles.${workspace.role}`)}</small>
              </label>
            );
          })}
        </fieldset>

        <div className={styles.actions}>
          <button className={styles.secondaryButton} disabled={busy || expired} onClick={onDeny} type="button">
            {t("deny")}
          </button>
          <button className="auth-submit" disabled={busy || expired || !selectedWorkspaceId} type="submit">
            {busy ? t("processing") : t("approve")}
          </button>
        </div>
      </form>
    </AuthScreen>
  );
}
