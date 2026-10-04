// node --test에서 React 훅을 1회 렌더로 실제 실행하기 위한 최소 런타임.
// 재렌더는 흉내내지 않는다. 저장 훅의 판단은 ref에 들어 있어 1회 렌더만으로 검증할 수 있다.

let slots = [];
let cursor = 0;
let cleanups = [];

/** 훅 호출 직전에 slot 커서를 되돌린다. 매 테스트는 render()로 새로 시작한다. */
export function render(hook) {
  slots = [];
  cursor = 0;
  cleanups = [];
  const result = hook();
  return { result, unmount: () => cleanups.forEach((cleanup) => cleanup?.()) };
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
