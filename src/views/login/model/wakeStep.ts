// GET /wake 응답의 phase. unknown은 기능 꺼짐·접근 코드 미통과·조회 실패.
export type WakePhase = "asleep" | "sleeping" | "waking" | "awake" | "unknown";

/**
 * 상태 확인 한 번의 다음 행동.
 * - request-wake: 안내 표시, 기동 요청 재전송(서버가 60초 중복 방지), 다시 확인
 * - wait: 안내 표시, 다시 확인
 * - probe: 노드는 떴으니 앱 응답을 확인하고, 실패하면 다시 확인
 * - stop: 확인 종료
 */
export type WakeStep = "request-wake" | "wait" | "probe" | "stop";

export function decideWakeStep(phase: WakePhase, isNoticeShown: boolean): WakeStep {
  if (phase === "asleep") return "request-wake";
  if (phase === "sleeping" || phase === "waking") return "wait";
  // 안내 중에 unknown이면 일시 오류로 보고 계속 확인한다. 처음부터 unknown이면 기능이 꺼진 것이다.
  if (phase === "unknown") return isNoticeShown ? "wait" : "stop";
  return isNoticeShown ? "probe" : "stop";
}

/** 앱 준비 확인 응답 판정. 401 등 4xx도 서버가 응답한 것이라 준비된 것으로 본다. */
export function isReadyStatus(status: number): boolean {
  return status < 500;
}
