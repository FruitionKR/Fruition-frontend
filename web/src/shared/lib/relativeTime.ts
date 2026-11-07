import type { SharedTranslate } from "@/shared/i18n/sharedTranslate";

type RelativeUnit = "minutes" | "hours" | "days" | "weeks" | "months" | "years";

const KOREAN_UNITS: Record<RelativeUnit, string> = { minutes: "분", hours: "시간", days: "일", weeks: "주", months: "달", years: "년" };

function relativeAmount(diffMs: number): { unit: RelativeUnit; count: number } | null {
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  const days = Math.floor(hours / 24);
  if (days < 7) return { unit: "days", count: days };
  if (days < 30) return { unit: "weeks", count: Math.floor(days / 7) };
  if (days < 365) return { unit: "months", count: Math.floor(days / 30) };
  return { unit: "years", count: Math.floor(days / 365) };
}

/** ISO 시각을 "N분 전" 형태로 변환한다. t(`useTranslations("shared")`)를 넘기면 지금 언어(복수형 포함)로 쓴다. */
export function formatRelativeTime(iso: string, t?: SharedTranslate): string {
  const amount = relativeAmount(Date.now() - new Date(iso).getTime());
  if (!amount) return t ? t("relativeTime.justNow") : "방금 전";
  if (t) return t(`relativeTime.${amount.unit}`, { count: amount.count });
  return `${amount.count}${KOREAN_UNITS[amount.unit]} 전`;
}
