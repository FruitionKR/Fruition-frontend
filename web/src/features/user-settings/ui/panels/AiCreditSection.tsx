"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { fetchCredits, formatKrwMilli, usageRefetchInterval, type ChargeUsage } from "@/entities/ai";
import { fetchBetaCredit, useMe } from "@/entities/user";
import { ApiError, getErrorMessage } from "@/shared/lib/apiErrors";
import type { AppMessages } from "@/shared/i18n/messages";
import styles from "../SettingsModal.module.css";
import { SettingsSectionHeader } from "../SettingsSectionHeader";
import usageStyles from "./AiUsageSection.module.css";

/** 잔액·가용액은 음수일 수 있어 부호를 따로 붙인다(formatKrwMilli는 음수를 0으로 본다). */
function formatSignedKrwMilli(value: number, t: Parameters<typeof formatKrwMilli>[1]): string {
  return value < 0 ? `-${formatKrwMilli(-value, t)}` : formatKrwMilli(value, t);
}

/**
 * AI 설정의 크레딧: GET users/me/credits의 가용액·잔액·예약과 베타 크레딧 실제 지급 상태.
 * 합계 카드는 AI 사용량과 같은 모양을 쓴다. 베타 지급 기록은 원장 최근 50건에서 밀려나므로 beta-credit 상태로 보인다.
 * 잔액 제한이 면제된 기존 가입자에게는 음수 잔액이 빚처럼 보이지 않도록 섹션 전체를 숨긴다.
 */
export function AiCreditSection() {
  const t = useTranslations("settings.ai.credit");
  const locale = useLocale();
  const tShared = useTranslations("shared");
  const { data: me } = useMe();
  const credits = useQuery({
    queryKey: ["credits", me?.id],
    queryFn: fetchCredits,
    enabled: Boolean(me?.id),
    retry: false,
    refetchInterval: (query) => usageRefetchInterval(query.state.error),
    refetchOnWindowFocus: "always"
  });
  // useBetaCreditNotice와 같은 키라 알림과 캐시를 나눠 쓴다.
  const beta = useQuery({
    queryKey: ["betaCredit", me?.id],
    queryFn: fetchBetaCredit,
    enabled: Boolean(me?.id),
    retry: false
  });
  const betaStatus = beta.data?.status;
  const charges = credits.data?.entries?.filter((entry) => entry.type === "charge" && entry.amount_krw_milli < 0);
  const exactAmount = (amount: number) => new Intl.NumberFormat(locale, {
    style: "currency", currency: "KRW", maximumFractionDigits: 3
  }).format(amount / 1000);
  const history = credits.data?.charge_history;
  const kindLabel = (kind: string | null) => {
    const key = `history.kinds.${kind}` as `history.kinds.${keyof AppMessages["settings"]["ai"]["credit"]["history"]["kinds"]}`;
    return kind && t.has(key) ? t(key) : t("history.unknownTask");
  };
  const usageTitle = (usage: ChargeUsage) => `${kindLabel(usage.kind)} · ${usage.model || t("history.unknownModel")}`;
  const count = (value: number | null) => value == null ? t("history.unknownValue") : value.toLocaleString(locale);
  const mcpFees = history ? history.reduce((sum, entry) => sum + (entry.reason === "mcp_approval" ? entry.amount_krw_milli : 0), 0) : charges?.reduce((sum, entry) => sum + (entry.reason === "mcp_approval" ? -entry.amount_krw_milli : 0), 0) ?? 0;

  if (credits.data?.limit_exempt) return null;

  return (
    <section className={styles.section} aria-labelledby="ai-credit-heading">
      <SettingsSectionHeader id="ai-credit-heading">{t("section")}</SettingsSectionHeader>

      {credits.isError && !credits.data ? (
        credits.error instanceof ApiError && credits.error.status === 404 ? (
          <small className={styles["status-text"]}>{t("unavailable")}</small>
        ) : (
          <small className={styles["field-error"]} role="alert">{getErrorMessage(credits.error, t("loadFailed"), tShared)}</small>
        )
      ) : !credits.data ? (
        <small className={styles["status-text"]} role="status">{t("loading")}</small>
      ) : (
        <div className={usageStyles.hero}>
          <div className={usageStyles["hero-top"]}>
            <div className={usageStyles.total}>
              <span className={usageStyles.eyebrow}>{t("available")}</span>
              <p className={usageStyles["total-value"]}>{formatSignedKrwMilli(credits.data.available_krw_milli, tShared)}</p>
            </div>
            {credits.data.reserved_krw_milli > 0 && (
              <dl className={usageStyles["side-stats"]}>
                <div>
                  <dt>{t("balance")}</dt>
                  <dd>{formatSignedKrwMilli(credits.data.balance_krw_milli, tShared)}</dd>
                </div>
                <div>
                  <dt>{t("reserved")}</dt>
                  <dd>{formatKrwMilli(credits.data.reserved_krw_milli, tShared)}</dd>
                </div>
              </dl>
            )}
          </div>
          <p className={usageStyles["cost-note"]}>{t("note")}</p>
          <p className={usageStyles["cost-note"]}>{t("exhaustNotice")}</p>
        </div>
      )}

      {(history || charges) && (
        <div>
          <strong>{t("history.title")}</strong>
          <p className={usageStyles.note}>{t(history ? "history.groupedScope" : "history.scope")}</p>
          <div className={styles.row}>
            <span>{t("history.mcpTotal")}</span>
            <strong>{exactAmount(mcpFees)}</strong>
          </div>
          {history ? (
            history.length === 0 ? <p className={usageStyles.note}>{t("history.empty")}</p> : (
              <ul className={usageStyles["charge-history"]}>
                {history.map((entry) => {
                  const isMcp = entry.reason === "mcp_approval";
                  const usage = entry.usage;
                  const title = isMcp ? t("history.mcpFee") : usage.length === 1
                    ? usageTitle(usage[0]) : usage.length > 0
                      ? [...new Set(usage.map((item) => kindLabel(item.kind)))].join(" · ") : t("history.aiUsage");
                  return (
                    <li key={entry.id} className={usageStyles["charge-group"]}>
                      <div className={styles.row}>
                        <div className={styles["row-title"]}>
                          <strong>{title}</strong>
                          {usage.length > 0 && <small>{t("history.calls", { count: usage.reduce((sum, item) => sum + item.calls, 0) })}</small>}
                          <small>{t("history.chargedAt")} <time dateTime={entry.charged_at}>{new Date(entry.charged_at).toLocaleString(locale)}</time></small>
                        </div>
                        <strong>{exactAmount(entry.amount_krw_milli)}</strong>
                      </div>
                      {!isMcp && (usage.length === 0 ? <p className={usageStyles.note}>{t("history.detailsUnavailable")}</p> : (
                        <details className={usageStyles["charge-details"]}>
                          <summary>{t("history.details")}</summary>
                          <ul className={usageStyles["charge-history"]}>
                            {usage.map((item, index) => (
                              <li key={index}>
                                <div className={styles.row}>
                                  <strong>{usageTitle(item)}</strong>
                                  <strong>{exactAmount(item.amount_krw_milli)}</strong>
                                </div>
                                <p>{t("history.calls", { count: item.calls })}{item.provider ? ` · ${item.provider}` : ""}</p>
                                <p>{t("history.executionTime")} <time dateTime={item.started_at}>{new Date(item.started_at).toLocaleString(locale)}</time>
                                  {item.last_started_at !== item.started_at && <> – <time dateTime={item.last_started_at}>{new Date(item.last_started_at).toLocaleString(locale)}</time></>}
                                </p>
                                <p>{t("history.tokens", { input: count(item.input_tokens), output: count(item.output_tokens), cached: count(item.cached_input_tokens), created: count(item.cache_creation_tokens) })}</p>
                                {item.audio_seconds != null && <p>{t("history.audio", { seconds: count(item.audio_seconds) })}</p>}
                                {item.tts_characters != null && <p>{t("history.characters", { count: count(item.tts_characters) })}</p>}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ))}
                    </li>
                  );
                })}
              </ul>
            )
          ) : charges?.length === 0 ? <p className={usageStyles.note}>{t("history.empty")}</p> : (
            <ul className={usageStyles["charge-history"]}>
              {charges?.map((entry, index) => (
                <li key={`${entry.run_id}:${entry.created_at}:${index}`} className={styles.row}>
                  <div className={styles["row-title"]}>
                    <strong>{t(entry.reason === "mcp_approval" ? "history.mcpFee" : "history.aiUsage")}</strong>
                    <small><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString(locale)}</time></small>
                  </div>
                  <strong>{exactAmount(-entry.amount_krw_milli)}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(betaStatus === "granted" || betaStatus === "pending") && (
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>{t("beta.label")}</strong>
            <small>{t("beta.description")}</small>
          </div>
          <strong>
            {betaStatus === "granted"
              ? t("beta.granted", { amount: formatKrwMilli(beta.data?.amount_krw_milli ?? 0, tShared) })
              : t("beta.pending")}
          </strong>
        </div>
      )}
    </section>
  );
}
