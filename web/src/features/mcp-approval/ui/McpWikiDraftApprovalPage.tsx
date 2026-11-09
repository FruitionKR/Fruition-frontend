"use client";

import { useConfirmation } from "@/shared/ui/modal/useConfirmation";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/entities/user";
import {
  approveMcpWikiDraft,
  cancelMcpWikiDraft,
  fetchMcpWikiDraft,
  rejectMcpWikiDraft
} from "../api/wikiDraftApproval";
import {
  canApproveMcpWikiDraft,
  canCancelMcpWikiDraft,
  mcpWikiDecisionErrorKey,
  mcpWikiDraftQueryKey,
  mcpWikiDraftRoute,
  shouldPollMcpWikiDraft,
  type McpWikiWebDraft
} from "../lib/wikiDraftPreview";
import { LoginRequiredError } from "@/shared/lib/apiErrors";
import { setAfterLoginPath } from "@/shared/lib/authSessionStorage";
import { WikiDraftPreview } from "./WikiDraftPreview";
import styles from "./McpApprovalPage.module.css";

export default function McpWikiDraftApprovalPage({ workspaceId, draftId }: { workspaceId: string; draftId: string }) {
  const { confirm, confirmationDialog } = useConfirmation();
  const t = useTranslations("mcpApproval.wiki");
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const userId = me.data?.id ?? "";
  const route = mcpWikiDraftRoute(workspaceId, draftId);
  const queryKey = mcpWikiDraftQueryKey(userId, workspaceId, draftId);
  const decisionLock = useRef(false);
  const draftQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchMcpWikiDraft(workspaceId, draftId, signal),
    enabled: Boolean(userId),
    retry: false,
    refetchInterval: (query) => !query.state.error && shouldPollMcpWikiDraft(query.state.data) ? 3000 : false
  });
  // Refetch failure must never leave a stale body or quote actionable on screen.
  const draft = draftQuery.error ? null : draftQuery.data ?? null;
  const update = (next: McpWikiWebDraft) => queryClient.setQueryData(queryKey, next);
  const settleDecision = () => { decisionLock.current = false; void queryClient.invalidateQueries({ queryKey }); };
  const approve = useMutation({ mutationFn: () => approveMcpWikiDraft(workspaceId, draft!), retry: false, onSuccess: update, onSettled: settleDecision });
  const reject = useMutation({ mutationFn: () => rejectMcpWikiDraft(workspaceId, draftId), retry: false, onSuccess: update, onSettled: settleDecision });
  const cancel = useMutation({ mutationFn: () => cancelMcpWikiDraft(workspaceId, draftId), retry: false, onSuccess: update, onSettled: settleDecision });
  const startDecision = (mutate: () => void) => {
    if (decisionLock.current) return;
    decisionLock.current = true;
    mutate();
  };

  useEffect(() => {
    const error = me.error ?? draftQuery.error;
    if (!(error instanceof LoginRequiredError)) return;
    setAfterLoginPath(route);
    router.replace("/login");
  }, [draftQuery.error, me.error, route, router]);

  useEffect(() => {
    const clear = () => queryClient.removeQueries({ queryKey: ["mcpWikiDraftApproval"] });
    window.addEventListener("fruition:auth-cleared", clear);
    return () => window.removeEventListener("fruition:auth-cleared", clear);
  }, [queryClient]);

  const money = (value: number) => format.number(value, { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
  const errorMessage = (error: unknown) => t(`errors.${mcpWikiDecisionErrorKey(error)}`);
  const actionError = approve.error ?? reject.error ?? cancel.error;
  const canApprove = Boolean(draft && canApproveMcpWikiDraft(draft));
  const decisionPending = approve.isPending || reject.isPending || cancel.isPending;

  if (me.isPending || (userId && draftQuery.isPending)) return <main className={styles.page}><p role="status">{t("loading")}</p></main>;
  if (me.error || draftQuery.error) {
    const error = me.error ?? draftQuery.error;
    return <main className={styles.page}><section className={styles.card}><h1>{t("title")}</h1><p role="alert">{error instanceof LoginRequiredError ? t("login") : errorMessage(error)}</p></section></main>;
  }
  if (!draft || !me.data) return <main className={styles.page}><p role="status">{t("loading")}</p></main>;

  return (
    <main className={styles.page}>
      {confirmationDialog}
      <section className={styles.card} aria-labelledby="mcp-wiki-draft-title">
        <header className={styles.header}>
          <div><p className={styles.eyebrow}>{t("origin")}</p><h1 id="mcp-wiki-draft-title">{t("title")}</h1></div>
          <button type="button" className={styles.secondary} disabled={draftQuery.isFetching} onClick={() => void draftQuery.refetch()}>{t("refresh")}</button>
        </header>

        <dl className={styles.details}>
          <div><dt>{t("client")}</dt><dd>{draft.client_name ?? t("clientUnavailable")}</dd></div>
          <div><dt>{t("kind")}</dt><dd>{draft.draft_kind}</dd></div>
          <div><dt>{t("version")}</dt><dd>{draft.draft_version}</dd></div>
          <div><dt>{t("draftHash")}</dt><dd className={styles.hash}>{draft.draft_hash}</dd></div>
          <div><dt>{t("publicHash")}</dt><dd className={styles.hash}>{draft.public_state_hash}</dd></div>
          <div><dt>{t("approvalStatus")}</dt><dd>{draft.approval.status}</dd></div>
        </dl>
        {draft.approval.reason && <p className={styles.warning}>{draft.approval.reason}</p>}

        <section className={styles.fees} aria-label={t("fees.title")}>
          <h2>{t("fees.title")}</h2>
          <dl className={styles.details}>
            <div><dt>{t("fees.model")}</dt><dd>{draft.quote.pricing_model}</dd></div>
            <div><dt>{t("fees.quantity")}</dt><dd>{draft.quote.quantity} {draft.quote.unit}</dd></div>
            <div><dt>{t("fees.formula")}</dt><dd>{draft.quote.formula}</dd></div>
            <div><dt>{t("fees.maximum")}</dt><dd>{money(draft.quote.maximum_charge_minor)}</dd></div>
            <div><dt>{t("fees.currency")}</dt><dd>{draft.quote.currency}</dd></div>
            <div><dt>{t("fees.version")}</dt><dd>{draft.quote.price_version}</dd></div>
          </dl>
          <p>{t("fees.bound")}</p>
          <p>{t("fees.charge")}</p>
        </section>

        <WikiDraftPreview preview={draft.preview} />

        <section className={styles.status} aria-label={t("status.title")}>
          <h2>{t("status.title")}</h2>
          <dl className={styles.details}>
            <div><dt>{t("status.publication")}</dt><dd>{draft.publication.status}</dd></div>
            <div><dt>{t("status.settlement")}</dt><dd>{draft.settlement.status}</dd></div>
            <div><dt>{t("status.charge")}</dt><dd>{["SETTLED", "ADJUSTED"].includes(draft.settlement.status) ? money(draft.settlement.charged_minor) : t("status.notFinal")}</dd></div>
            {draft.publication.error_code && <div><dt>{t("status.error")}</dt><dd>{draft.publication.error_code}</dd></div>}
          </dl>
          {draft.publication.status === "UNKNOWN" && <p className={styles.warning} role="status">{t("status.unknown")}</p>}
          {draft.settlement.status === "PENDING_RECONCILIATION" && <p className={styles.warning} role="status">{t("status.pending")}</p>}
          {draft.publication.status === "PUBLISHED" && draft.publication.changed && <p>{t("status.publishedCharge")}</p>}
          {draft.publication.status === "NO_CHANGE" && <p>{t("status.noChange")}</p>}
          {draft.publication.status === "PUBLISHED" && draft.publication.changed && <Link href="/home?view=logs">{t("status.history")}</Link>}
        </section>

        {!canApprove && draft.approval.status === "AWAITING" && <p className={styles.warning} role="status">{draft.client_name ? t("approvalUnavailable") : t("clientApprovalUnavailable")}</p>}
        {actionError && <p role="alert">{errorMessage(actionError)}</p>}
        <div className={styles.actions}>
          {draft.approval.status === "AWAITING" && <button type="button" className={styles.secondary} disabled={decisionPending} onClick={async () => { if (await confirm({ title: t("rejectConfirm"), confirmLabel: t("reject") })) startDecision(reject.mutate); }}>{t("reject")}</button>}
          {draft.approval.status === "AWAITING" && <button type="button" className={styles.primary} disabled={decisionPending || !canApprove} onClick={() => startDecision(approve.mutate)}>{approve.isPending ? t("approving") : t("approve")}</button>}
          {canCancelMcpWikiDraft(draft) && <button type="button" className={styles.danger} disabled={decisionPending} onClick={async () => { if (await confirm({ title: t("cancelConfirm"), confirmLabel: t("cancel"), tone: "danger" })) startDecision(cancel.mutate); }}>{cancel.isPending ? t("cancelling") : t("cancel")}</button>}
        </div>
      </section>
    </main>
  );
}
