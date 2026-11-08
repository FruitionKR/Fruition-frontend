"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/entities/user";
import { cancelAgentPlanRun, fetchAgentPlanRunById } from "@/features/agent-chat/api/agentPlan";
import { agentPlanStatusLabel, canApproveAgentPlan, type AgentPlanRun, type McpPriceSnapshot } from "@/features/agent-chat/lib/agentPlan";
import { AgentPlanTaskDetail } from "@/features/agent-chat/ui/AgentPlanTaskDetail";
import { LoginRequiredError } from "@/shared/lib/apiErrors";
import { setAfterLoginPath } from "@/shared/lib/authSessionStorage";
import {
  canCancelMcpRun,
  initialMcpSelectedOperationIds,
  mcpApprovalAvailability,
  mcpApprovalQueryKey,
  mcpApprovalRoute,
  mcpApprovalSelectionKey,
  mcpDecisionErrorKey,
  shouldPollMcpApproval
} from "../lib/mcpApproval";
import styles from "./McpApprovalPage.module.css";

export default function McpApprovalPage({ workspaceId, runId }: { workspaceId: string; runId: string }) {
  const t = useTranslations("mcpApproval");
  const tAgent = useTranslations("agentChat");
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const userId = me.data?.id ?? "";
  const route = mcpApprovalRoute(workspaceId, runId);
  const queryKey = mcpApprovalQueryKey(userId, workspaceId, runId);
  const runQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchAgentPlanRunById(workspaceId, runId, signal),
    enabled: Boolean(userId),
    retry: false,
    refetchInterval: (query) => !query.state.error && shouldPollMcpApproval(query.state.data) ? 3000 : false
  });
  const run = runQuery.data ?? null;
  const availability = mcpApprovalAvailability(run);
  const quote = run?.mcp_approval_quote ?? null;
  const settlement = run?.mcp_settlement ?? null;
  const clientName = quote?.client_name ?? settlement?.client_name;
  const selectionScope = run?.plan ? mcpApprovalSelectionKey(userId, workspaceId, runId, run.plan) : "";
  const initialOperationIds = run?.plan ? initialMcpSelectedOperationIds(run.plan) : [];
  const [reviewSelection, setReviewSelection] = useState<{
    scope: string;
    operationIds: readonly string[];
    priceSnapshot: McpPriceSnapshot | null;
  } | null>(null);
  const activeSelection = reviewSelection?.scope === selectionScope ? reviewSelection : null;
  const selectedOperationCount = activeSelection?.operationIds.length ?? initialOperationIds.length;
  const priceSnapshot = activeSelection?.priceSnapshot
    ?? (activeSelection && availability.available ? { ...availability.priceSnapshot, maximum_charge_minor: 0 } : null)
    ?? (availability.available ? availability.priceSnapshot : settlement?.price_snapshot ?? null);
  const cancel = useMutation({
    mutationFn: () => cancelAgentPlanRun(workspaceId, runId),
    onSuccess: (updated) => queryClient.setQueryData<AgentPlanRun>(queryKey, (current) => ({
      ...updated,
      plan: updated.plan ?? current?.plan ?? null,
      mcp_approval_quote: updated.mcp_approval_quote ?? current?.mcp_approval_quote
    })),
    onSettled: () => queryClient.invalidateQueries({ queryKey })
  });

  useEffect(() => {
    const error = me.error ?? runQuery.error;
    if (!(error instanceof LoginRequiredError)) return;
    setAfterLoginPath(route);
    router.replace("/login");
  }, [me.error, route, router, runQuery.error]);

  useEffect(() => {
    const clear = () => queryClient.removeQueries({ queryKey: ["mcpApproval"] });
    window.addEventListener("fruition:auth-cleared", clear);
    return () => window.removeEventListener("fruition:auth-cleared", clear);
  }, [queryClient]);

  const money = (value: number) => format.number(value, { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
  const approvalDisabledReason = run && canApproveAgentPlan(run) && !availability.available
    ? t(`unavailable.${availability.reason}`)
    : null;
  const decisionError = (error: unknown) => t(`errors.${mcpDecisionErrorKey(error)}`);
  const handleSelectionChange = useCallback((selection: { operationIds: readonly string[]; priceSnapshot: McpPriceSnapshot | null }) => {
    setReviewSelection({ scope: selectionScope, ...selection });
  }, [selectionScope]);

  function requestCancel() {
    if (cancel.isPending || !window.confirm(t("cancel.confirm"))) return;
    cancel.mutate();
  }

  if (me.isPending || (userId && runQuery.isPending)) return <main className={styles.page}><p role="status">{t("loading")}</p></main>;
  if (me.error || runQuery.error) {
    const error = me.error ?? runQuery.error;
    return <main className={styles.page}><section className={styles.card}><h1>{t("title")}</h1><p role="alert">{error instanceof LoginRequiredError ? t("login") : t("errors.inaccessible")}</p></section></main>;
  }
  if (!run || !me.data) return <main className={styles.page}><p role="status">{t("loading")}</p></main>;

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="mcp-approval-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{t("origin")}</p>
            <h1 id="mcp-approval-title">{t("title")}</h1>
          </div>
          <button type="button" className={styles.secondary} disabled={runQuery.isFetching} onClick={() => void runQuery.refetch()}>{t("refresh")}</button>
        </header>

        <dl className={styles.details}>
          <div><dt>{t("client")}</dt><dd>{clientName || t("unavailable.client")}</dd></div>
          <div><dt>{t("grant")}</dt><dd>{run.grant_id || t("unavailable.value")}</dd></div>
          <div><dt>{t("runStatus")}</dt><dd>{agentPlanStatusLabel(run.status, tAgent)}</dd></div>
          <div><dt>{t("planVersion")}</dt><dd>{run.plan?.version ?? t("unavailable.value")}</dd></div>
          <div><dt>{t("planHash")}</dt><dd className={styles.hash}>{run.plan?.operation_hash || t("unavailable.value")}</dd></div>
        </dl>

        {priceSnapshot && (
          <section className={styles.fees} aria-label={t("fees.title")}>
            <h2>{t("fees.title")}</h2>
            <dl className={styles.details}>
              {quote && <div><dt>{t("fees.operations")}</dt><dd>{selectedOperationCount}</dd></div>}
              <div><dt>{t("fees.unit")}</dt><dd>{money(priceSnapshot.unit_price_minor)}</dd></div>
              <div><dt>{t("fees.cap")}</dt><dd>{money(priceSnapshot.plan_cap_minor)}</dd></div>
              <div><dt>{t("fees.maximum")}</dt><dd>{money(priceSnapshot.maximum_charge_minor)}</dd></div>
              <div><dt>{t("fees.currency")}</dt><dd>{priceSnapshot.currency}</dd></div>
              <div><dt>{t("fees.version")}</dt><dd>{priceSnapshot.price_version}</dd></div>
            </dl>
            <p>{t("fees.scope")}</p>
            <p>{t("fees.partial")}</p>
          </section>
        )}

        {settlement && (
          <section className={styles.status} aria-label={t("settlement.title")}>
            <h2>{t("settlement.title")}</h2>
            <dl className={styles.details}>
              <div><dt>{t("settlement.execution")}</dt><dd>{t(`execution.${settlement.execution_status}`)}</dd></div>
              <div><dt>{t("settlement.forward")}</dt><dd>{t(`forward.${settlement.forward_status}`)}</dd></div>
              <div><dt>{t("settlement.status")}</dt><dd>{t(`settlementStatus.${settlement.settlement_status}`)}</dd></div>
              <div><dt>{t("settlement.charge")}</dt><dd>{settlement.settlement_status === "SETTLED" ? money(settlement.charged_minor) : t("settlement.notFinal")}</dd></div>
            </dl>
          </section>
        )}

        {run.status === "halted" && <p className={styles.warning} role="alert">{t("halted")}</p>}
        <AgentPlanTaskDetail
          action="mcp_plan"
          approvalDisabledReason={approvalDisabledReason}
          errorMessage={decisionError}
          isRunFetching={runQuery.isFetching}
          mcpContext={{ workspaceId, userId: me.data.id, runId }}
          mcpQuote={availability.available ? quote : null}
          onMcpSelectionChange={handleSelectionChange}
          onRefetch={() => void runQuery.refetch()}
          run={run}
          runError={runQuery.error}
          turnId={runId}
        />

        {canCancelMcpRun(run.status) && (
          <div className={styles.cancelArea}>
            <p>{t("cancel.notice")}</p>
            {cancel.error && <p role="alert">{decisionError(cancel.error)}</p>}
            <button type="button" className={styles.danger} disabled={cancel.isPending} onClick={requestCancel}>{cancel.isPending ? t("cancel.processing") : t("cancel.button")}</button>
          </div>
        )}
      </section>
    </main>
  );
}
