// node --test에서 React 훅을 실제로 실행하기 위한 최소 런타임.
// setState는 스스로 재렌더하지 않는다. 재렌더가 필요한 테스트는 rerender()를 직접 호출한다.

let slots = [];
let cursor = 0;
let cleanups = [];

/** 훅 호출 직전에 slot 커서를 되돌린다. 매 테스트는 render()로 새로 시작한다. */
export function render(hook) {
  slots = [];
  cursor = 0;
  cleanups = [];
  const box = {
    result: runHook(hook),
    // setState 후 새 렌더 결과(파생값·콜백)를 보려면 호출한다.
    rerender: () => (box.result = runHook(hook)),
    unmount: () => cleanups.forEach((cleanup) => cleanup?.())
  };
  return box;
}

function runHook(hook) {
  cursor = 0;
  return hook();
}

export function useState(initial) {
  const index = cursor++;
  if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
  const slot = slots[index];
  return [slot.value, (next) => {
    slot.value = typeof next === "function" ? next(slot.value) : next;
  }];
}

export function useRef(initial) {
  const index = cursor++;
  if (!slots[index]) slots[index] = { current: initial };
  return slots[index];
}

export function useEffect(effect) {
  cursor++;
  cleanups.push(effect());
}

export function useMemo(factory) {
  cursor++;
  return factory();
}

export function useCallback(callback) {
  cursor++;
  return callback;
}
