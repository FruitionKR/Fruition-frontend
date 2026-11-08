import type { SharedTranslate } from "@/shared/i18n/sharedTranslate";

/** 서버가 대기 시간을 알려 주지 않은 429에 쓰는 값. 인증번호 재요청 제한(resend cooldown)과 같다. */
const DEFAULT_WAIT_SECONDS = 60;

/** 인증번호 요청·이메일 중복 확인이 시도 제한(429)에 걸렸으면 기다릴 시간(초), 그 밖의 실패면 null. */
export function verificationWaitSeconds(error: unknown): number | null {
  const { status, retryAfter } = (error ?? {}) as { status?: unknown; retryAfter?: unknown };
  if (status !== 429) return null;
  return typeof retryAfter === "number" && retryAfter > 0 ? retryAfter : DEFAULT_WAIT_SECONDS;
}

function formatWait(seconds: number, t?: SharedTranslate): string {
  if (seconds < 60) return t ? t("verification.wait.seconds", { count: seconds }) : `${seconds}초`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return t ? t("verification.wait.minutes", { count: minutes }) : `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (t) return rest > 0 ? t("verification.wait.hoursMinutes", { hours, minutes: rest }) : t("verification.wait.hours", { count: hours });
  return rest > 0 ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

/** 시도 제한 안내. t(`useTranslations("shared")`)를 넘기면 지금 언어(복수형 포함)로 쓴다. */
export function verificationWaitMessage(seconds: number, t?: SharedTranslate): string {
  if (t) return t("verification.tooFrequent", { wait: formatWait(seconds, t) });
  return `인증 요청이 너무 잦아요. ${formatWait(seconds)} 후 다시 시도해 주세요.`;
}
