import { useCallback, useEffect, useState } from "react";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { parseTreeOpenIds, serializeTreeOpenIds, toggleTreeOpenId } from "@/widgets/workspace/lib/treeOpenState";
import { conversionCollapseStorageKey } from "./treeConversionGroups";

type CollapseState = { key: string | null; ids: ReadonlySet<string> };

function readCollapsedIds(): CollapseState {
  try {
    const workspaceId = getSelectedWorkspaceId();
    if (!workspaceId) return { key: null, ids: new Set() };
    const key = conversionCollapseStorageKey(workspaceId);
    return { key, ids: parseTreeOpenIds(window.localStorage.getItem(key)) };
  } catch {
    // 저장소를 쓸 수 없으면 모두 펼친 상태로 시작한다.
    return { key: null, ids: new Set() };
  }
}

/**
 * 원본 PDF 아래 변환본 묶음의 접힘 상태. 기본은 펼침이고 접은 원본 PDF 행 id만 워크스페이스별 localStorage에 둔다.
 * 사이드바가 다시 마운트돼도(뷰 전환) 깜빡이지 않게 첫 렌더 전에 읽는다. 트리 행은 문서 목록을 받은 뒤에만 그려져 SSR 결과와 어긋나지 않는다.
 */
export function useConversionCollapse() {
  const [state, setState] = useState<CollapseState>(() => (typeof window === "undefined" ? { key: null, ids: new Set() } : readCollapsedIds()));

  useEffect(() => {
    if (!state.key) return;
    try {
      window.localStorage.setItem(state.key, serializeTreeOpenIds(state.ids));
    } catch {
      // 저장이 막혀도 접기·펼치기는 현재 화면에서 계속 동작한다.
    }
  }, [state]);

  const toggle = useCallback((id: string) => setState((current) => ({ ...current, ids: toggleTreeOpenId(current.ids, id) })), []);

  return { collapsedIds: state.ids, toggle };
}
