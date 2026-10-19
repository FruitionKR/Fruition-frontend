import { useSyncExternalStore } from "react";

type Deselection = { planKey: string; ids: ReadonlySet<string> };

// 폴더 정리 미리보기(메인 영역)와 작업 탭 카드(에이전트 패널)는 서로 다른 트리에 있어, 사용자가 미리보기에서 바꾼
// 선택을 turn별로 이 저장소에 둔다. 카드의 수락도 같은 선택으로 적용한다.
let deselections: ReadonlyMap<string, Deselection> = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * 사용자가 미리보기에서 선택 해제한 줄 id. 아직 바꾸지 않았거나 계획(id·version)이 바뀌었으면 null이고,
 * 그때는 AI가 권장한 기본 선택(initialDeselectedRowIds)을 쓴다.
 */
export function useFolderOrganizeDeselection(turnId: string | null | undefined, planKey: string | null) {
  const entry = useSyncExternalStore(subscribe, () => (turnId ? deselections.get(turnId) : undefined), () => undefined);
  const ids = entry && entry.planKey === planKey ? entry.ids : null;

  function setIds(next: ReadonlySet<string>) {
    if (!turnId || !planKey) return;
    deselections = new Map(deselections).set(turnId, { planKey, ids: next });
    listeners.forEach((listener) => listener());
  }

  return [ids, setIds] as const;
}
