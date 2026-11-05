import type { CSSProperties } from "react";
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
  const hasCache = summary.models.some((item) => item.cachedInputTokens > 0);
  const hasNonTokenUsage = summary.models.some((item) => formatNonTokenUsage(item) !== null);
  const modelShares = toPercentShares(summary.models.map((item) => item.totalTokens));

  return (
    <>
      <UsageHero summary={summary} rangeLabel={rangeLabel} />
      <div className={styles.models}>
        <div className={styles["models-head"]}>
          <span>모델별</span>
          <span>{summary.models.length}개 모델</span>
        </div>
        <ol className={styles["model-list"]} aria-hidden="true">
          {summary.models.map((item, index) => (
            <ModelRow key={item.key} item={item} rank={index + 1} share={modelShares[index]}
              ratio={summary.totalTokens > 0 ? item.totalTokens / summary.totalTokens : 0} />
          ))}
        </ol>
        <table className={styles["sr-only"]}>
          <caption>모델별 사용량 · {rangeLabel}</caption>
          <thead>
            <tr>
              <th scope="col">모델</th>
              <th scope="col">입력 토큰</th>
              <th scope="col">출력 토큰</th>
              {hasCache && <th scope="col">캐시 토큰</th>}
              <th scope="col">합계</th>
              <th scope="col">비율</th>
              {hasNonTokenUsage && <th scope="col">음성·글자</th>}
              <th scope="col">금액</th>
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
                {hasNonTokenUsage && <td>{formatNonTokenUsage(item) ?? "없음"}</td>}
                <td>{formatKnownCharge(item.chargeKrwMilli, item.unpricedCalls) ?? "알 수 없음"}</td>
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
  const notes = [
    hasCache ? "캐시 토큰은 입력에 포함되어 합계에 따로 더하지 않아요." : null,
    summary.unpricedCalls > 0 ? `단가를 확인하지 못한 호출 ${formatTokenCount(summary.unpricedCalls)}건은 금액에서 빠졌어요.` : null,
    summary.needsReviewCalls > 0 ? `사용량을 알 수 없는 호출 ${formatTokenCount(summary.needsReviewCalls)}건은 0원으로 처리됐어요.` : null
  ].filter(Boolean);
  return notes.length > 0 ? <p className={styles.note}>{notes.join(" ")}</p> : null;
}

function UsageHero({ summary, rangeLabel }: { summary: ModelUsageSummary; rangeLabel: string }) {
  const [inputShare, outputShare] = toPercentShares([summary.inputTokens, summary.outputTokens]);
  const compact = formatCompactTokenCount(summary.totalTokens);
  const exact = formatTokenCount(summary.totalTokens);
  const charge = formatKnownCharge(summary.chargeKrwMilli, summary.unpricedCalls);

  return (
    <div className={styles.hero}>
      <div className={styles["hero-top"]}>
        <div className={styles.total}>
          <span className={styles.eyebrow}>합계 · {rangeLabel}</span>
          <p className={styles["total-value"]}>
            <span aria-hidden={compact !== exact || undefined} title={`${exact} 토큰`}>{compact}</span>
            <span className={styles["total-unit"]} aria-hidden={compact !== exact || undefined}>토큰</span>
            {compact !== exact && <span className={styles["total-exact"]}>{exact} 토큰</span>}
          </p>
        </div>
        <dl className={styles["side-stats"]}>
          <div>
            <dt>사용 금액</dt>
            <dd>{charge ?? <span className={styles["cost-unknown"]}>알 수 없음</span>}</dd>
          </div>
          <div>
            <dt>호출</dt>
            <dd>{formatTokenCount(summary.calls)}<span>회</span></dd>
          </div>
        </dl>
      </div>
      <SplitBar input={summary.inputTokens} output={summary.outputTokens} className={styles["hero-bar"]} />
      <ul className={styles.legend}>
        <li>
          <i className={styles["swatch-input"]} aria-hidden="true" />
          <span className={styles["legend-label"]}>입력</span>
          <strong>{formatTokenCount(summary.inputTokens)}</strong>
          <span className={styles["legend-share"]}>{formatPercentShare(inputShare, summary.inputTokens)}</span>
        </li>
        <li>
          <i className={styles["swatch-output"]} aria-hidden="true" />
          <span className={styles["legend-label"]}>출력</span>
          <strong>{formatTokenCount(summary.outputTokens)}</strong>
          <span className={styles["legend-share"]}>{formatPercentShare(outputShare, summary.outputTokens)}</span>
        </li>
      </ul>
      <p className={styles["cost-note"]}>금액은 부가세 포함이에요.</p>
    </div>
  );
}

function ModelRow({ item, rank, share, ratio }: {
  item: ModelUsageSummaryRow; rank: number; share: number; ratio: number;
}) {
  const icon = providerIcons[item.provider];
  const providerLabel = getProviderLabel(item.provider);
  const hasTokens = item.totalTokens > 0;
  const nonTokenUsage = formatNonTokenUsage(item);
  const showTokenDetail = hasTokens || nonTokenUsage === null;
  const charge = formatKnownCharge(item.chargeKrwMilli, item.unpricedCalls);
  const detail = [
    providerLabel,
    showTokenDetail ? `입력 ${formatTokenCount(item.inputTokens)}` : null,
    showTokenDetail ? `출력 ${formatTokenCount(item.outputTokens)}` : null,
    item.cachedInputTokens > 0 ? `캐시 ${formatTokenCount(item.cachedInputTokens)}` : null,
    hasTokens ? nonTokenUsage : null
  ].filter(Boolean).join(" · ");

  return (
    <li className={styles.model} title={`${item.label} · 합계 ${formatTokenCount(item.totalTokens)} 토큰`}>
      <span className={styles.rank}>{rank}</span>
      <span className={styles["provider-icon"]} data-provider={item.provider}>
        {icon ? <SvgIcon src={icon} /> : <span>{providerLabel.slice(0, 1).toUpperCase()}</span>}
      </span>
      <span className={styles["model-name"]}>
        <strong>{item.label}</strong>
        <small>{detail}</small>
      </span>
      <span className={styles["model-value"]}>
        <strong>{hasTokens ? formatCompactTokenCount(item.totalTokens) : nonTokenUsage ?? "0"}</strong>
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
