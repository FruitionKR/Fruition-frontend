import type { DragEvent as ReactDragEvent } from "react";

// 드래그 프리뷰를 화면 밖으로 숨기기 위한 오프스크린 위치
const DRAG_PREVIEW_OFFSCREEN_POSITION = "-1000px";

/**
 * dragleave가 현재 요소 밖으로 나가는 경우인지 판단한다.
 * relatedTarget이 currentTarget 내부 자식이면(요소 안에서의 이동) false를 반환한다.
 */
export function isPointerLeavingElement<T extends HTMLElement>(event: ReactDragEvent<T>): boolean {
  const next = event.relatedTarget;
  return !(next instanceof Node && event.currentTarget.contains(next));
}

export function setLightDragPreview(event: ReactDragEvent<HTMLButtonElement>) {
  const source = event.currentTarget;
  const rect = source.getBoundingClientRect();
  const preview = source.cloneNode(true) as HTMLElement;

  preview.style.position = "fixed";
  preview.style.top = DRAG_PREVIEW_OFFSCREEN_POSITION;
  preview.style.left = DRAG_PREVIEW_OFFSCREEN_POSITION;
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;
  preview.style.opacity = "0.06";
  preview.style.background = "rgba(255, 255, 255, 0.24)";
  preview.style.border = "1px solid rgba(207, 215, 227, 0.18)";
  preview.style.boxShadow = "none";
  preview.style.pointerEvents = "none";
  preview.style.zIndex = "-1";
  document.body.appendChild(preview);

  event.dataTransfer.setDragImage(preview, 14, Math.min(18, rect.height / 2));
  window.setTimeout(() => preview.remove(), 0);
}
