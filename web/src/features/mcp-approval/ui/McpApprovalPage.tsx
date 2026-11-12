"use client";

import { useConfirmation } from "@/shared/ui/modal/useConfirmation";

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
  MCP_EXECUTION_STATUSES,
  MCP_FORWARD_STATUSES,
  MCP_SETTLEMENT_STATUSES,
  canCancelMcpRun,
  initialMcpSelectedOperationIds,
  mcpApprovalAvailability,
  mcpApprovalQueryKey,
  mcpApprovalRoute,
  mcpApprovalSelectionKey,
  mcpDecisionErrorKey,
  mcpRunCostLine,
  mcpRunHeadline,
  mcpRunTone,
  shouldPollMcpApproval
} from "../lib/mcpApproval";
import { mcpKnownCode } from "../lib/wikiDraftPreview";
import styles from "./McpApprovalPage.module.css";

export default function McpApprovalPage({ workspaceId, runId }: { workspaceId: string; runId: string }) {
  const { confirm, confirmationDialog } = useConfirmation();
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

  async function requestCancel() {
    if (cancel.isPending || !await confirm({ title: t("cancel.confirm"), confirmLabel: t("cancel.button"), tone: "danger" })) return;
    cancel.mutate();
  }

  if (me.isPending || (userId && runQuery.isPending)) return <main className={styles.page}><p role="status">{t("loading")}</p></main>;
  if (me.error || runQuery.error) {
    const error = me.error ?? runQuery.error;
    return <main className={styles.page}><section className={styles.card}><h1 className={styles.title}>{t("title")}</h1><p className={styles.notice} data-tone="danger" role="alert">{error instanceof LoginRequiredError ? t("login") : t("errors.inaccessible")}</p></section></main>;
  }
  if (!run || !me.data) return <main className={styles.page}><p role="status">{t("loading")}</p></main>;

  const headline = mcpRunHeadline(run.plan);
  const cost = mcpRunCostLine(settlement, priceSnapshot);
  const costText = !cost ? null : cost.kind === "free" ? t("cost.free") : t(`cost.${cost.kind}`, { amount: money(cost.amount) });
  const code = (value: string) => <> <span className={styles.code}>{value}</span></>;

  return (
    <main className={styles.page}>
      {confirmationDialog}
      <article className={styles.card} aria-labelledby="mcp-approval-title">
        <header className={styles.hero}>
          <div className={styles.heroTop}>
            <p className={styles.eyebrow}>{t("eyebrow")}</p>
            <button type="button" className={styles.ghost} disabled={runQuery.isFetching} onClick={() => void runQuery.refetch()}>{t("refresh")}</button>
          </div>
          <h1 id="mcp-approval-title">{t(`headline.${headline.kind}`, { client: clientName || t("clientFallback"), count: headline.count })}</h1>
          <dl className={styles.overview}>
            <div><dt>{t("overview.status")}</dt><dd><span className={styles.badge} data-tone={mcpRunTone(run.status)}>{agentPlanStatusLabel(run.status, tAgent)}</span></dd></div>
            {costText && <div><dt>{t("overview.cost")}</dt><dd className={styles.costText}>{costText}</dd></div>}
          </dl>
        </header>

        {run.status === "halted" && <p className={styles.notice} data-tone="warning" role="alert">{t("halted")}</p>}

        <section className={styles.section} aria-labelledby="mcp-approval-core">
          <h2 id="mcp-approval-core">{t("core")}</h2>
          <AgentPlanTaskDetail
            action="mcp_plan"
            approvalDisabledReason={approvalDisabledReason}
            decisionClassNames={{ row: styles.actions, accept: styles.primary, reject: styles.secondary }}
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
        </section>

        {canCancelMcpRun(run.status) && (
          <div className={styles.cancelArea}>
            <p>{t("cancel.notice")}</p>
            {cancel.error && <p className={styles.notice} data-tone="danger" role="alert">{decisionError(cancel.error)}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.danger} disabled={cancel.isPending} onClick={requestCancel}>{cancel.isPending ? t("cancel.processing") : t("cancel.button")}</button>
            </div>
          </div>
        )}

        <details className={styles.more}>
          <summary>{t("more.summary")}</summary>
          <section className={styles.moreGroup} aria-label={t("more.request")}>
            <h2>{t("more.request")}</h2>
            <dl className={styles.facts}>
              <div><dt>{t("client")}</dt><dd>{clientName || t("unavailable.client")}</dd></div>
              <div><dt>{t("more.clientId")}</dt><dd className={styles.code}>{run.client_id || t("unavailable.value")}</dd></div>
              <div><dt>{t("grant")}</dt><dd className={styles.code}>{run.grant_id || t("unavailable.value")}</dd></div>
              <div><dt>{t("runStatus")}</dt><dd>{agentPlanStatusLabel(run.status, tAgent)}{code(run.status)}</dd></div>
              <div><dt>{t("planVersion")}</dt><dd>{run.plan?.version ?? t("unavailable.value")}</dd></div>
              <div><dt>{t("planHash")}</dt><dd className={styles.code}>{run.plan?.operation_hash || t("unavailable.value")}</dd></div>
            </dl>
          </section>
          {priceSnapshot && (
            <section className={styles.moreGroup} aria-label={t("fees.title")}>
              <h2>{t("fees.title")}</h2>
              <dl className={styles.facts}>
                {quote && <div><dt>{t("fees.operations")}</dt><dd>{selectedOperationCount}</dd></div>}
                <div><dt>{t("fees.unit")}</dt><dd>{money(priceSnapshot.unit_price_minor)}</dd></div>
                <div><dt>{t("fees.cap")}</dt><dd>{money(priceSnapshot.plan_cap_minor)}</dd></div>
                <div><dt>{t("fees.maximum")}</dt><dd>{priceSnapshot.maximum_charge_minor === 0 ? t("fees.free") : money(priceSnapshot.maximum_charge_minor)}</dd></div>
                <div><dt>{t("fees.currency")}</dt><dd>{priceSnapshot.currency}</dd></div>
                <div><dt>{t("fees.version")}</dt><dd>{priceSnapshot.price_version}</dd></div>
              </dl>
              <p>{t("fees.scope")}</p>
              <p>{t("fees.partial")}</p>
            </section>
          )}
          {settlement && (
            <section className={styles.moreGroup} aria-label={t("settlement.title")}>
              <h2>{t("settlement.title")}</h2>
              <dl className={styles.facts}>
                <div><dt>{t("settlement.execution")}</dt><dd>{t(`execution.${mcpKnownCode(MCP_EXECUTION_STATUSES, settlement.execution_status)}`)}{code(settlement.execution_status)}</dd></div>
                <div><dt>{t("settlement.forward")}</dt><dd>{t(`forward.${mcpKnownCode(MCP_FORWARD_STATUSES, settlement.forward_status)}`)}{code(settlement.forward_status)}</dd></div>
                <div><dt>{t("settlement.status")}</dt><dd>{t(`settlementStatus.${mcpKnownCode(MCP_SETTLEMENT_STATUSES, settlement.settlement_status)}`)}{code(settlement.settlement_status)}</dd></div>
                <div><dt>{t("settlement.charge")}</dt><dd>{settlement.settlement_status === "SETTLED" ? money(settlement.charged_minor) : t("settlement.notFinal")}</dd></div>
              </dl>
            </section>
          )}
        </details>
      </article>
    </main>
  );
}
