/** auth.verification.wait 아래 메시지 키와 값. */
export type VerificationWaitMessage =
  | { key: "seconds"; values: { seconds: number } }
  | { key: "minutes"; values: { minutes: number } }
  | { key: "hours"; values: { hours: number } }
  | { key: "hoursMinutes"; values: { hours: number; minutes: number } };

/**
 * 인증 요청 시도 제한의 남은 시간을 문구 키로 바꾼다. 1분 미만은 초, 1시간 미만은 분(올림), 그 이상은 시간·분.
 * 단위 이름과 복수형은 언어별 메시지(ICU)가 정한다.
 */
export function verificationWaitMessage(seconds: number): VerificationWaitMessage {
  if (seconds < 60) return { key: "seconds", values: { seconds } };
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return { key: "minutes", values: { minutes } };
  const rest = minutes % 60;
  const hours = Math.floor(minutes / 60);
  return rest > 0 ? { key: "hoursMinutes", values: { hours, minutes: rest } } : { key: "hours", values: { hours } };
}
