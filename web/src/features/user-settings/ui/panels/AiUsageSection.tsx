"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AI_USAGE_PERIOD_OPTIONS, LOCKED_AI_MODELS, fetchAiModels, fetchModelUsage, formatUsageRange,
  resolveUsageRange, summarizeModelUsage, type AiUsagePeriod
} from "@/entities/ai";
import { useSelectedWorkspace } from "@/entities/workspace";
import { ApiError, getErrorMessage } from "@/shared/lib/apiErrors";
import { OptionSelect } from "@/shared/ui/OptionSelect";
import styles from "../SettingsModal.module.css";
import { SettingsSectionHeader } from "../SettingsSectionHeader";
import { AiUsageBreakdown } from "./AiUsageBreakdown";
import usageStyles from "./AiUsageSection.module.css";

/**
 * 사용자 설정 맨 아래 AI 사용량: 지금 워크스페이스에서 내가 쓴 모델별 토큰(GET usage/models).
 * 금액·크레딧은 사업자 등록 전까지 보이지 않는다(users/me/credits·usage/charges 미호출).
 */
export function AiUsageSection() {
  const workspace = useSelectedWorkspace();
  const [period, setPeriod] = useState<AiUsagePeriod>("this_month");
  const usage = useQuery({
    queryKey: ["aiUsage", workspace?.id ?? null, period],
    queryFn: async () => {
      const range = resolveUsageRange(period, new Date());
      return { range, response: await fetchModelUsage(workspace!.id, range) };
    },
    enabled: Boolean(workspace),
    retry: false
  });
  // 표 이름만 쓰므로 실패해도 모델 id로 보인다. 정책으로 빠진 모델의 지난 사용량도 이름을 찾도록 잠금 목록을 더한다.
  const catalog = useQuery({ queryKey: ["ai-models"], queryFn: fetchAiModels, staleTime: Infinity });
  const summary = usage.data
    ? summarizeModelUsage(usage.data.response.models, [...(catalog.data ?? []), ...LOCKED_AI_MODELS])
    : null;

  return (
    <section className={styles.section} aria-labelledby="ai-usage-heading">
      <SettingsSectionHeader id="ai-usage-heading">AI 사용량</SettingsSectionHeader>
      <div className={usageStyles.head}>
        <div className={styles["row-title"]}>
          <strong>{workspace ? `${workspace.name}에서 내가 쓴 토큰` : "이 워크스페이스에서 내가 쓴 토큰"}</strong>
          <small>지금 워크스페이스에서 내 계정으로 실행한 AI 작업만 셉니다.</small>
        </div>
        <div className={usageStyles.period}>
          <OptionSelect value={period} placeholder="기간" options={AI_USAGE_PERIOD_OPTIONS} ariaLabel="사용량 기간" floating
            onChange={(value) => setPeriod(value as AiUsagePeriod)} />
        </div>
      </div>

      {usage.isError ? (
        <UsageError error={usage.error} retrying={usage.isFetching} onRetry={() => void usage.refetch()} />
      ) : !summary || !usage.data ? (
        <UsageSkeleton />
      ) : summary.models.length === 0 ? (
        <UsageEmpty title="이 기간에 AI 사용 기록이 없어요." description="AI 작업을 실행하면 모델별 사용량이 여기에 쌓여요." />
      ) : (
        <div className={usageStyles.body} aria-busy={usage.isFetching || undefined}>
          <AiUsageBreakdown summary={summary} rangeLabel={formatUsageRange(usage.data.range)} />
        </div>
      )}
    </section>
  );
}

/** 실제 화면 모양(합계 카드 + 모델 막대 두 줄)을 그대로 비운 자리 표시 */
function UsageSkeleton() {
  return (
    <div className={usageStyles.skeleton} aria-busy="true">
      <span className={usageStyles["sr-only"]} role="status">AI 사용량을 불러오는 중…</span>
      <div className={usageStyles["skeleton-hero"]}>
        <span className={usageStyles["skeleton-line"]} style={{ width: 120 }} />
        <span className={usageStyles["skeleton-total"]} />
        <span className={usageStyles["skeleton-bar"]} />
        <span className={usageStyles["skeleton-line"]} style={{ width: "60%" }} />
      </div>
      {["72%", "28%"].map((width) => (
        <div key={width} className={usageStyles["skeleton-model"]}>
          <span className={usageStyles["skeleton-line"]} style={{ width: "40%" }} />
          <span className={usageStyles["skeleton-bar"]} style={{ width }} />
        </div>
      ))}
    </div>
  );
}

function UsageEmpty({ title, description }: { title: string; description?: string }) {
  return (
    <div className={usageStyles.empty}>
      <span className={usageStyles["empty-bar"]} aria-hidden="true" />
      <strong>{title}</strong>
      {description && <small>{description}</small>}
    </div>
  );
}

/** 404는 멤버가 아니거나 백엔드에 경로가 아직 없는 경우라 다시 시도해도 같다. 중립 안내만 보인다. */
function UsageError({ error, retrying, onRetry }: { error: unknown; retrying: boolean; onRetry: () => void }) {
  if (error instanceof ApiError && error.status === 404) {
    return <UsageEmpty title="이 워크스페이스에서는 아직 AI 사용량을 볼 수 없어요." />;
  }
  return (
    <div className={usageStyles.error}>
      <small className={styles["field-error"]} role="alert">{getErrorMessage(error, "AI 사용량을 불러오지 못했습니다.")}</small>
      <button type="button" className={styles.btn} disabled={retrying} onClick={onRetry}>
        {retrying ? "다시 불러오는 중…" : "다시 시도"}
      </button>
    </div>
  );
}
