// 겹쳐 연 패널을 브라우저 뒤로 가기로 닫기 위한 history 표식 규칙. DOM 없이 테스트하는 순수 함수만 둔다.
const OVERLAY_DEPTH_KEY = "fruitionOverlayDepth";

/** 이 history 항목이 몇 번째 겹친 패널의 표식인지. 표식이 아니면 0이다. */
export function getOverlayDepth(state: unknown): number {
  if (!state || typeof state !== "object") return 0;
  const depth = (state as Record<string, unknown>)[OVERLAY_DEPTH_KEY];
  return typeof depth === "number" ? depth : 0;
}

export function createOverlayEntry(depth: number): Record<string, number> {
  return { [OVERLAY_DEPTH_KEY]: depth };
}

/** 뒤로 가기로 자기 표식보다 아래 항목에 도착했으면 패널을 닫는다. */
export function isOverlayDismissedBy(state: unknown, ownDepth: number): boolean {
  return getOverlayDepth(state) < ownDepth;
}

/** 패널이 표식 위에서 이동하면 표식을 남기지 않게 push 대신 replace한다. */
export function resolveNavigationMode(state: unknown, mode: "push" | "replace"): "push" | "replace" {
  return getOverlayDepth(state) > 0 ? "replace" : mode;
}
