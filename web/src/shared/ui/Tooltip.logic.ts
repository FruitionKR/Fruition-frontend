/** Tooltip의 지연·위치 계산. DOM 없이 테스트할 수 있게 순수 함수로 둔다. */

export type TooltipPlacement = "right" | "left" | "top" | "bottom";

/** 첫 표시 지연 */
export const TOOLTIP_OPEN_DELAY_MS = 150;
/** 마지막 툴팁이 닫힌 뒤 이 시간 안에 다른 트리거로 옮기면 지연 없이 바로 띄운다(그룹 warm-up). */
export const TOOLTIP_WARM_WINDOW_MS = 300;
/** 트리거와 말풍선 사이 간격 */
export const TOOLTIP_GAP_PX = 8;
/** 화면 가장자리 여백 */
const TOOLTIP_VIEWPORT_MARGIN_PX = 8;
/** 꼬리가 말풍선 모서리(radius 8px)에 걸리지 않도록 두는 최소 거리 */
const ARROW_EDGE_PX = 10;

export function getTooltipOpenDelay({
  now,
  lastClosedAt,
  isAnyOpen
}: {
  now: number;
  /** 마지막으로 닫힌 시각. 한 번도 닫힌 적 없으면 null */
  lastClosedAt: number | null;
  isAnyOpen: boolean;
}): number {
  if (isAnyOpen) return 0;
  if (lastClosedAt !== null && now - lastClosedAt < TOOLTIP_WARM_WINDOW_MS) return 0;
  return TOOLTIP_OPEN_DELAY_MS;
}

type Rect = { top: number; left: number; width: number; height: number };
type Size = { width: number; height: number };

export type TooltipPosition = {
  top: number;
  left: number;
  /** 화면 밖으로 넘쳐 반대편으로 뒤집힌 경우 실제 배치 */
  placement: TooltipPlacement;
  /** 꼬리 위치. right/left는 말풍선 위쪽에서, top/bottom은 왼쪽에서의 거리(px) */
  arrowOffset: number;
};

const OPPOSITE: Record<TooltipPlacement, TooltipPlacement> = {
  right: "left",
  left: "right",
  top: "bottom",
  bottom: "top"
};

function clamp(value: number, min: number, max: number): number {
  // 말풍선이 화면보다 크면 시작 여백을 우선한다.
  return Math.max(min, Math.min(value, max));
}

function place(anchor: Rect, size: Size, placement: TooltipPlacement): { top: number; left: number } {
  const centerX = anchor.left + anchor.width / 2;
  const centerY = anchor.top + anchor.height / 2;
  switch (placement) {
    case "right":
      return { top: centerY - size.height / 2, left: anchor.left + anchor.width + TOOLTIP_GAP_PX };
    case "left":
      return { top: centerY - size.height / 2, left: anchor.left - TOOLTIP_GAP_PX - size.width };
    case "top":
      return { top: anchor.top - TOOLTIP_GAP_PX - size.height, left: centerX - size.width / 2 };
    case "bottom":
      return { top: anchor.top + anchor.height + TOOLTIP_GAP_PX, left: centerX - size.width / 2 };
  }
}

function overflowsMainAxis(position: { top: number; left: number }, size: Size, viewport: Size, placement: TooltipPlacement) {
  const margin = TOOLTIP_VIEWPORT_MARGIN_PX;
  if (placement === "right") return position.left + size.width > viewport.width - margin;
  if (placement === "left") return position.left < margin;
  if (placement === "top") return position.top < margin;
  return position.top + size.height > viewport.height - margin;
}

/**
 * 트리거 rect 기준으로 말풍선 위치를 계산한다(position: fixed 좌표).
 * 진행 방향으로 넘치면 반대편으로 뒤집고, 교차 방향은 화면 안으로 밀어 넣되 꼬리는 트리거 중앙을 계속 가리킨다.
 */
export function computeTooltipPosition({
  anchor,
  size,
  viewport,
  placement
}: {
  anchor: Rect;
  size: Size;
  viewport: Size;
  placement: TooltipPlacement;
}): TooltipPosition {
  let resolved = placement;
  let position = place(anchor, size, placement);
  if (overflowsMainAxis(position, size, viewport, placement)) {
    const flipped = OPPOSITE[placement];
    const flippedPosition = place(anchor, size, flipped);
    if (!overflowsMainAxis(flippedPosition, size, viewport, flipped)) {
      resolved = flipped;
      position = flippedPosition;
    }
  }

  const margin = TOOLTIP_VIEWPORT_MARGIN_PX;
  const isHorizontal = resolved === "right" || resolved === "left";
  if (isHorizontal) {
    const top = clamp(position.top, margin, viewport.height - margin - size.height);
    const arrowOffset = clamp(anchor.top + anchor.height / 2 - top, ARROW_EDGE_PX, size.height - ARROW_EDGE_PX);
    return { top, left: position.left, placement: resolved, arrowOffset };
  }
  const left = clamp(position.left, margin, viewport.width - margin - size.width);
  const arrowOffset = clamp(anchor.left + anchor.width / 2 - left, ARROW_EDGE_PX, size.width - ARROW_EDGE_PX);
  return { top: position.top, left, placement: resolved, arrowOffset };
}
