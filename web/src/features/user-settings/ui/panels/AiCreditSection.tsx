"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { fetchCredits, formatKrwMilli } from "@/entities/ai";
import { fetchBetaCredit, useMe } from "@/entities/user";
import { ApiError, getErrorMessage } from "@/shared/lib/apiErrors";
import styles from "../SettingsModal.module.css";
import { SettingsSectionHeader } from "../SettingsSectionHeader";
import usageStyles from "./AiUsageSection.module.css";

/** 잔액·가용액은 음수일 수 있어 부호를 따로 붙인다(formatKrwMilli는 음수를 0으로 본다). */
function formatSignedKrwMilli(value: number, t: Parameters<typeof formatKrwMilli>[1]): string {
  return value < 0 ? `-${formatKrwMilli(-value, t)}` : formatKrwMilli(value, t);
}

/**
 * AI 설정의 크레딧: GET users/me/credits의 가용액·잔액·예약과 베타 $5 크레딧 지급 상태.
 * 합계 카드는 AI 사용량과 같은 모양을 쓴다. 베타 지급 기록은 원장 최근 50건에서 밀려나므로 beta-credit 상태로 보인다.
 */
export function AiCreditSection() {
  const t = useTranslations("settings.ai.credit");
  const tShared = useTranslations("shared");
  const { data: me } = useMe();
  const credits = useQuery({
    queryKey: ["credits", me?.id],
    queryFn: fetchCredits,
    enabled: Boolean(me?.id),
    retry: false,
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
