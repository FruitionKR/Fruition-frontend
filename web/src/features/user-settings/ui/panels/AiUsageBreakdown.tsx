import type { CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  formatCompactTokenCount, formatKnownCharge, formatNonTokenUsage, formatPercentShare, formatTokenCount, getProviderLabel,
  toPercentShares, type ModelUsageSummary, type ModelUsageSummaryRow
} from "@/entities/ai";
import { claudeIcon, geminiIcon, gptIcon, SvgIcon, type SvgAsset } from "@/shared/ui/SvgIcon";
import styles from "./AiUsageSection.module.css";

// provider id → 아이콘 (WorkspaceModelMenu와 같은 자산)
const providerIcons: Record<string, SvgAsset> = {
  openai: gptIcon,
  gemini: geminiIcon,
  claude: claudeIcon
};

/**
 * AI 사용량 시각화: 합계 카드(입력·출력 100% 막대) + 모델별 순위 막대.
 * 입력·출력은 같은 색의 두 단계(--color-usage-input/output)로, 카드의 범례가 모델 막대에도 그대로 적용된다.
 * 토큰이 0인 음성·TTS 줄은 막대가 비고 토큰 자리에 음성 시간·글자 수를 보인다.
 * 막대 목록은 aria-hidden이고 화면 낭독기는 같은 숫자를 숨긴 표로 읽는다.
 */
export function AiUsageBreakdown({ summary, rangeLabel }: { summary: ModelUsageSummary; rangeLabel: string }) {
  const t = useTranslations("settings");
  const tShared = useTranslations("shared");
  const hasCache = summary.models.some((item) => item.cachedInputTokens > 0);
  const hasNonTokenUsage = summary.models.some((item) => formatNonTokenUsage(item, tShared) !== null);
  const modelShares = toPercentShares(summary.models.map((item) => item.totalTokens));

  return (
    <>
      <UsageHero summary={summary} rangeLabel={rangeLabel} />
      <div className={styles.models}>
        <div className={styles["models-head"]}>
          <span>{t("ai.usage.byModel")}</span>
          <span>{t("ai.usage.modelCount", { count: summary.models.length })}</span>
        </div>
        <ol className={styles["model-list"]} aria-hidden="true">
          {summary.models.map((item, index) => (
            <ModelRow key={item.key} item={item} rank={index + 1} share={modelShares[index]}
              ratio={summary.totalTokens > 0 ? item.totalTokens / summary.totalTokens : 0} />
          ))}
        </ol>
        <table className={styles["sr-only"]}>
          <caption>{t("ai.usage.tableCaption", { range: rangeLabel })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("ai.usage.colModel")}</th>
              <th scope="col">{t("ai.usage.colInput")}</th>
              <th scope="col">{t("ai.usage.colOutput")}</th>
              {hasCache && <th scope="col">{t("ai.usage.colCache")}</th>}
              <th scope="col">{t("ai.usage.colTotal")}</th>
              <th scope="col">{t("ai.usage.colShare")}</th>
              {hasNonTokenUsage && <th scope="col">{t("ai.usage.colNonToken")}</th>}
              <th scope="col">{t("ai.usage.colCharge")}</th>
            </tr>
          </thead>
          <tbody>
            {summary.models.map((item, index) => (
              <tr key={item.key}>
                <th scope="row">{item.label}</th>
                <td>{formatTokenCount(item.inputTokens)}</td>
                <td>{formatTokenCount(item.outputTokens)}</td>
                {hasCache && <td>{formatTokenCount(item.cachedInputTokens)}</td>}
                <td>{formatTokenCount(item.totalTokens)}</td>
                <td>{formatPercentShare(modelShares[index], item.totalTokens)}</td>
                {hasNonTokenUsage && <td>{formatNonTokenUsage(item, tShared) ?? t("common.none")}</td>}
                <td>{formatKnownCharge(item.chargeKrwMilli, item.unpricedCalls, tShared) ?? t("common.unknown")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <UsageNotes summary={summary} hasCache={hasCache} />
    </>
  );
}

function UsageNotes({ summary, hasCache }: { summary: ModelUsageSummary; hasCache: boolean }) {
  const t = useTranslations("settings.ai.usage");
  const notes = [
    hasCache ? t("cacheNote") : null,
    summary.unpricedCalls > 0 ? t("unpricedNote", { count: formatTokenCount(summary.unpricedCalls) }) : null,
    summary.needsReviewCalls > 0 ? t("needsReviewNote", { count: formatTokenCount(summary.needsReviewCalls) }) : null
  ].filter(Boolean);
  return notes.length > 0 ? <p className={styles.note}>{notes.join(" ")}</p> : null;
}

function UsageHero({ summary, rangeLabel }: { summary: ModelUsageSummary; rangeLabel: string }) {
  const t = useTranslations("settings");
  const tShared = useTranslations("shared");
  const locale = useLocale();
  const [inputShare, outputShare] = toPercentShares([summary.inputTokens, summary.outputTokens]);
  const compact = formatCompactTokenCount(summary.totalTokens, locale);
  const exact = formatTokenCount(summary.totalTokens);
  const charge = formatKnownCharge(summary.chargeKrwMilli, summary.unpricedCalls, tShared);

  return (
    <div className={styles.hero}>
      <div className={styles["hero-top"]}>
        <div className={styles.total}>
          <span className={styles.eyebrow}>{t("ai.usage.totalEyebrow", { range: rangeLabel })}</span>
          <p className={styles["total-value"]}>
            <span aria-hidden={compact !== exact || undefined} title={t("ai.usage.tokens", { value: exact })}>{compact}</span>
            <span className={styles["total-unit"]} aria-hidden={compact !== exact || undefined}>{t("ai.usage.tokenUnit")}</span>
            {compact !== exact && <span className={styles["total-exact"]}>{t("ai.usage.tokens", { value: exact })}</span>}
          </p>
        </div>
        <dl className={styles["side-stats"]}>
          <div>
            <dt>{t("ai.usage.charge")}</dt>
            <dd>{charge ?? <span className={styles["cost-unknown"]}>{t("common.unknown")}</span>}</dd>
          </div>
          <div>
            <dt>{t("ai.usage.calls")}</dt>
            <dd>{t.rich("ai.usage.callCount", { value: formatTokenCount(summary.calls), unit: (chunks) => <span>{chunks}</span> })}</dd>
          </div>
        </dl>
      </div>
      <SplitBar input={summary.inputTokens} output={summary.outputTokens} className={styles["hero-bar"]} />
      <ul className={styles.legend}>
        <li>
          <i className={styles["swatch-input"]} aria-hidden="true" />
          <span className={styles["legend-label"]}>{t("ai.usage.input")}</span>
          <strong>{formatTokenCount(summary.inputTokens)}</strong>
          <span className={styles["legend-share"]}>{formatPercentShare(inputShare, summary.inputTokens)}</span>
        </li>
        <li>
          <i className={styles["swatch-output"]} aria-hidden="true" />
          <span className={styles["legend-label"]}>{t("ai.usage.output")}</span>
          <strong>{formatTokenCount(summary.outputTokens)}</strong>
          <span className={styles["legend-share"]}>{formatPercentShare(outputShare, summary.outputTokens)}</span>
        </li>
      </ul>
      <p className={styles["cost-note"]}>{t("ai.usage.vatNote")}</p>
    </div>
  );
}

function ModelRow({ item, rank, share, ratio }: {
  item: ModelUsageSummaryRow; rank: number; share: number; ratio: number;
}) {
  const t = useTranslations("settings.ai.usage");
  const tShared = useTranslations("shared");
  const locale = useLocale();
  const icon = providerIcons[item.provider];
  const providerLabel = getProviderLabel(item.provider);
  const hasTokens = item.totalTokens > 0;
  const nonTokenUsage = formatNonTokenUsage(item, tShared);
  const showTokenDetail = hasTokens || nonTokenUsage === null;
  const charge = formatKnownCharge(item.chargeKrwMilli, item.unpricedCalls, tShared);
  const detail = [
    providerLabel,
    showTokenDetail ? t("inputDetail", { value: formatTokenCount(item.inputTokens) }) : null,
    showTokenDetail ? t("outputDetail", { value: formatTokenCount(item.outputTokens) }) : null,
    item.cachedInputTokens > 0 ? t("cacheDetail", { value: formatTokenCount(item.cachedInputTokens) }) : null,
    hasTokens ? nonTokenUsage : null
  ].filter(Boolean).join(" · ");

  return (
    <li className={styles.model} title={t("modelTitle", { model: item.label, value: formatTokenCount(item.totalTokens) })}>
      <span className={styles.rank}>{rank}</span>
      <span className={styles["provider-icon"]} data-provider={item.provider}>
        {icon ? <SvgIcon src={icon} /> : <span>{providerLabel.slice(0, 1).toUpperCase()}</span>}
      </span>
      <span className={styles["model-name"]}>
        <strong>{item.label}</strong>
        <small>{detail}</small>
      </span>
      <span className={styles["model-value"]}>
        <strong>{hasTokens ? formatCompactTokenCount(item.totalTokens, locale) : nonTokenUsage ?? "0"}</strong>
        <small>
          {charge !== null && <span className={styles["model-cost"]}>{charge}</span>}
          {hasTokens && <span>{formatPercentShare(share, item.totalTokens)}</span>}
        </small>
      </span>
      <span className={styles["model-track"]}>
        <SplitBar input={item.inputTokens} output={item.outputTokens} className={styles["model-bar"]}
          style={{ width: `${Math.max(ratio * 100, 1)}%` }} />
      </span>
    </li>
  );
}

/** 입력·출력 두 조각 막대. 조각 사이 2px 틈이 경계를 만든다. 0이 아닌 조각은 최소 2px로 보인다. */
function SplitBar({ input, output, className, style }: { input: number; output: number; className: string; style?: CSSProperties }) {
  return (
    <span className={className} style={style} aria-hidden="true">
      {input > 0 && <span className={styles["segment-input"]} style={{ flexGrow: input }} />}
      {output > 0 && <span className={styles["segment-output"]} style={{ flexGrow: output }} />}
    </span>
  );
}
