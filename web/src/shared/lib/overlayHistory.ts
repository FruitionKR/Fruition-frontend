// 겹쳐 연 패널을 브라우저 뒤로 가기로 닫기 위한 history 표식 규칙. 창은 인자로 받아 실제 DOM 없이 테스트한다.
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

type OverlayWindow = Pick<Window, "history" | "location" | "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">;

/**
 * 패널마다 history 표식을 쌓고 되돌린다.
 * history.back()은 비동기라, 끝나기 전에 새 표식을 쌓으면 되돌릴 표식 위에 쌓이고 뒤늦은 popstate가 새 패널을 닫는다.
 * 그래서 진행 중인 back()을 세어 두고, 표식을 쌓거나 되돌리는 일은 모두 끝난 뒤로 미룬다.
 */
export function createOverlayHistory(win: OverlayWindow) {
  let pendingBacks = 0;
  let waiters: ReadonlyArray<() => void> = [];

  function goBack() {
    pendingBacks += 1;
    const settle = () => {
      win.removeEventListener("popstate", settle);
      pendingBacks -= 1;
      if (pendingBacks > 0) return;
      const ready = waiters;
      waiters = [];
      ready.forEach((run) => run());
    };
    win.addEventListener("popstate", settle);
    win.history.back();
  }

  /** 표식을 쌓는 일을 예약하고, 패널이 닫힐 때 부를 정리 함수를 돌려준다. */
  function open(onDismiss: () => void): () => void {
    let depth = 0;
    let isPopped = false;
    const handlePopState = (event: PopStateEvent) => {
      if (!isOverlayDismissedBy(event.state, depth)) return;
      isPopped = true;
      onDismiss();
    };
    const pushEntry = () => {
      if (pendingBacks > 0) {
        waiters = [...waiters, schedulePush];
        return;
      }
      depth = getOverlayDepth(win.history.state) + 1;
      win.history.pushState(createOverlayEntry(depth), "", win.location.href);
      win.addEventListener("popstate", handlePopState);
    };
    // 첫 렌더 직후 바로 닫히는 경우 표식이 쌓였다 빠지지 않도록 다음 틱에 쌓는다.
    let timer = 0;
    const schedulePush = () => {
      timer = win.setTimeout(pushEntry, 0);
    };
    const popEntry = () => {
      if (pendingBacks > 0) {
        waiters = [...waiters, popEntry];
        return;
      }
      if (getOverlayDepth(win.history.state) === depth) goBack();
    };
    schedulePush();
    return () => {
      win.clearTimeout(timer);
      waiters = waiters.filter((run) => run !== schedulePush);
      win.removeEventListener("popstate", handlePopState);
      if (depth > 0 && !isPopped) popEntry();
    };
  }

  return { open };
}
