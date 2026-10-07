import { useCallback, useEffect, useState } from "react";
import { getSelectedWorkspaceId } from "@/shared/lib/auth";
import {
  addTreeOpenIds,
  parseTreeOpenIds,
  serializeTreeOpenIds,
  toggleTreeOpenId,
  treeOpenStorageKey
} from "../lib/treeOpenState";

/**
 * 사이드바 폴더 펼침 상태. 뷰 전환으로 트리가 다시 마운트돼도 유지되도록 HomeWorkspace가 소유하고,
 * 같은 탭의 새로고침에도 남도록 워크스페이스별 sessionStorage에 저장한다.
 */
export function useTreeOpenState() {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  // 저장 키는 마운트 후에 정한다. 복원 전 빈 상태로 저장값을 덮어쓰지 않기 위해서다.
  const [storageKey, setStorageKey] = useState<string | null>(null);

  useEffect(() => {
    const workspaceId = getSelectedWorkspaceId();
    if (!workspaceId) return;
    const key = treeOpenStorageKey(workspaceId);
    try {
      const saved = parseTreeOpenIds(window.sessionStorage.getItem(key));
      setOpenIds((current) => addTreeOpenIds(current, [...saved]));
    } catch {
      // 저장소를 쓸 수 없어도 트리는 접힌 상태로 동작한다.
    }
    setStorageKey(key);
  }, []);

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.sessionStorage.setItem(storageKey, serializeTreeOpenIds(openIds));
    } catch {
      // 저장소가 차단되어도 펼침은 현재 화면에서 계속 동작한다.
    }
  }, [openIds, storageKey]);

  const toggle = useCallback((id: string) => setOpenIds((current) => toggleTreeOpenId(current, id)), []);
  const open = useCallback((id: string) => setOpenIds((current) => addTreeOpenIds(current, [id])), []);
  const openMany = useCallback((ids: readonly string[]) => setOpenIds((current) => addTreeOpenIds(current, ids)), []);

  return { openIds, toggle, open, openMany };
}
