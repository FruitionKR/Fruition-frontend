/** 서버가 대기 시간을 알려 주지 않은 429에 쓰는 값. 인증번호 재요청 제한(resend cooldown)과 같다. */
const DEFAULT_WAIT_SECONDS = 60;

/** 인증번호 요청·이메일 중복 확인이 시도 제한(429)에 걸렸으면 기다릴 시간(초), 그 밖의 실패면 null. */
export function verificationWaitSeconds(error: unknown): number | null {
  const { status, retryAfter } = (error ?? {}) as { status?: unknown; retryAfter?: unknown };
  if (status !== 429) return null;
  return typeof retryAfter === "number" && retryAfter > 0 ? retryAfter : DEFAULT_WAIT_SECONDS;
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}분`;
  const rest = minutes % 60;
  return rest > 0 ? `${Math.floor(minutes / 60)}시간 ${rest}분` : `${minutes / 60}시간`;
}

export function verificationWaitMessage(seconds: number): string {
  return `인증 요청이 너무 잦아요. ${formatWait(seconds)} 후 다시 시도해 주세요.`;
}
