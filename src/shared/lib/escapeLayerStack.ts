/**
 * Escape 키로 닫히는 레이어(모달·메뉴 등)의 스택.
 *
 * 각 레이어가 document에 따로 keydown 리스너를 달면 ESC 한 번에 열린 레이어가 모두 닫힌다.
 * 스택은 맨 위 레이어 하나만 처리하고, 그 키 입력을 다른 리스너에 넘기지 않는다.
 * "fallback" 레이어(트리·그래프 선택 해제 등)는 일반 레이어가 하나도 없을 때만 처리한다.
 */
export type EscapePriority = "layer" | "fallback";

/** 리렌더로 핸들러가 바뀌어도 스택 순서를 유지하도록 ref처럼 최신 핸들러를 담는다. */
export type EscapeHandlerRef = { readonly current: (() => void) | null };

/** handleEscapeKeyDown이 읽는 KeyboardEvent의 최소 형태. */
export type EscapeKeyEventLike = {
  key: string;
  isComposing: boolean;
  target: unknown;
  preventDefault(): void;
  stopImmediatePropagation(): void;
};

type Entry = { handler: EscapeHandlerRef; priority: EscapePriority };

export type EscapeLayerStack = {
  /** 레이어를 맨 위에 올리고, 제거 함수를 돌려준다. */
  push(handler: EscapeHandlerRef, priority?: EscapePriority): () => void;
  /** Escape keydown을 처리했으면 true. */
  handleKeyDown(event: EscapeKeyEventLike): boolean;
  readonly size: number;
};

/** 입력 중인 요소의 ESC(이름 변경 취소 등)는 fallback 레이어가 가로채지 않는다. */
function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT";
}

export function createEscapeLayerStack(): EscapeLayerStack {
  let entries: readonly Entry[] = [];

  function findTop(event: EscapeKeyEventLike): Entry | undefined {
    const layer = entries.findLast((entry) => entry.priority === "layer");
    if (layer) return layer;
    if (isEditableTarget(event.target)) return undefined;
    return entries.findLast((entry) => entry.priority === "fallback");
  }

  return {
    push(handler, priority = "layer") {
      const entry: Entry = { handler, priority };
      entries = [...entries, entry];
      return () => {
        entries = entries.filter((item) => item !== entry);
      };
    },
    handleKeyDown(event) {
      if (event.key !== "Escape" || event.isComposing) return false;
      const top = findTop(event);
      if (!top) return false;
      event.stopImmediatePropagation();
      event.preventDefault();
      top.handler.current?.();
      return true;
    },
    get size() {
      return entries.length;
    }
  };
}
