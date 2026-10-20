/**
 * "새 노트 추가"·파일 메뉴 "새 노트" 연타 막기와, 만든 노트의 제목 칸으로 포커스 옮기기.
 * 테스트가 직접 import하므로 다른 모듈을 import하지 않는다.
 */

/** 진행 중인 작업이 있으면 새 작업을 시작하지 않는다(무시하면 null). 버튼에 포커스가 남아 Space·Enter가 반복돼도 노트가 하나만 생긴다. */
export function createSingleFlight() {
  let pending = false;
  return {
    isPending: () => pending,
    run<T>(task: () => Promise<T>): Promise<T | null> {
      if (pending) return Promise.resolve(null);
      pending = true;
      return task().finally(() => {
        pending = false;
      });
    }
  };
}

const NOTE_TITLE_SELECTOR = 'input[aria-label="문서 이름"]';
const FOCUS_WAIT_MS = 3000;

/**
 * 연 노트의 제목 칸에 포커스를 옮기고 제목을 고른다. 편집 화면이 그려질 때까지 프레임마다 찾고,
 * 제목이 만든 노트 이름과 같아지면(이전 문서 화면이 아니면) 옮긴다. 시간 안에 못 찾으면 버튼 포커스만 뗀다.
 */
export function focusNoteTitleWhenReady(expectedTitle: string, root: Pick<Document, "querySelector" | "activeElement"> = document) {
  const startedAt = performance.now();
  (root.activeElement as HTMLElement | null)?.blur?.();
  function attempt() {
    const input = root.querySelector<HTMLInputElement>(NOTE_TITLE_SELECTOR);
    if (input && !input.disabled && !input.readOnly && input.value === expectedTitle) {
      input.focus();
      input.select();
      return;
    }
    if (performance.now() - startedAt < FOCUS_WAIT_MS) requestAnimationFrame(attempt);
  }
  requestAnimationFrame(attempt);
}
