import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccessGate } from "@/features/settings";
import type { RailView } from "@/widgets/rail-navigation/ui/RailNavigation";
import type { SelectableTreeItem } from "@/widgets/document-sidebar/model/types";
import { makeRawId, rawNodeIdToDocumentId } from "@/entities/graph/lib/graph";
import {
  buildWorkspaceHref,
  getWorkspaceLocationKey,
  getWorkspaceLocationView,
  isDocumentLocation,
  parseWorkspaceLocation,
  toDocumentLocation,
  WORKSPACE_HOME_LOCATION,
  type WorkspaceLocation
} from "../lib/workspaceLocation";
import { getSelectionLocation, type TreeSelectionState } from "./useTreeSelection";

/**
 * 워크스페이스 화면 상태는 URL(/home?doc=… · ?page=… · ?view=graph 등)에서 파생한다.
 * 쿼리만 바뀌므로 HomeWorkspace는 리마운트되지 않는다. 이동(push/replace)과 "문서" 전환이 돌아갈 마지막 문서 위치를 함께 가진다.
 */
export function useWorkspaceNavigation() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const location = useMemo(() => parseWorkspaceLocation(searchParams), [searchParams]);
  const locationKey = getWorkspaceLocationKey(location);
  const activeView = getWorkspaceLocationView(location);
  const navigate = useCallback((target: WorkspaceLocation, mode: "push" | "replace" = "push") => {
    const href = buildWorkspaceHref(target);
    if (mode === "replace") router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }, [router]);
  // 접근 코드 미입력 상태면 설정 화면에 고정한다. API는 middleware가 403으로 막는다.
  const { isLocked: isAccessLocked } = useAccessGate();
  useEffect(() => {
    if (isAccessLocked && activeView !== "settings") navigate({ kind: "view", view: "settings" }, "replace");
  }, [isAccessLocked, activeView, navigate]);

  // 사이드바 "문서" 전환이 돌아갈 마지막 문서 위치. 메모리에만 둔다(새로고침하면 첫 노트).
  const lastDocumentLocationRef = useRef<WorkspaceLocation | null>(null);
  useEffect(() => {
    if (isDocumentLocation(location)) lastDocumentLocationRef.current = location;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 위치 키가 같으면 같은 대상이다
  }, [locationKey]);

  /** 선택한 대상의 문서 URL로 이동한다(뒤로가기로 돌아올 수 있게 push). 이미 그 URL이면 그대로 둔다. */
  function openDocument(opened: TreeSelectionState | null) {
    const target = opened && getSelectionLocation(opened);
    if (!target || getWorkspaceLocationKey(target) === locationKey) return;
    navigate(target);
  }

  // 사이드바 문서 행 가운데 클릭: 그 문서 URL을 새 브라우저 탭으로 연다. 이 탭의 선택 상태는 바꾸지 않는다.
  function openTreeItemInNewTab(item: SelectableTreeItem) {
    const nodeId = item.graphNodeId ?? (item.documentId ? makeRawId(item.documentId) : null);
    if (!nodeId) return;
    const target = toDocumentLocation({
      pageId: null,
      documentId: rawNodeIdToDocumentId(nodeId) ?? item.documentId ?? null,
      treeItemId: item.id
    });
    if (target) window.open(buildWorkspaceHref(target), "_blank", "noopener");
  }

  // 문서 ↔ 그래프·로그·규칙 전환. "문서"는 마지막으로 본 문서 URL(없으면 /home → 첫 노트)로 돌아간다.
  function handleViewChange(view: RailView) {
    const target: WorkspaceLocation = view === "home"
      ? lastDocumentLocationRef.current ?? WORKSPACE_HOME_LOCATION
      : { kind: "view", view };
    if (getWorkspaceLocationKey(target) === locationKey) return;
    navigate(target);
  }

  /** 삭제된 대상이 "문서" 전환이 돌아갈 위치였으면 잊는다. 현재 URL이 삭제된 대상이면 true. */
  function forgetDeletedLocation(isDeleted: (target: WorkspaceLocation | null) => boolean) {
    if (isDeleted(lastDocumentLocationRef.current)) lastDocumentLocationRef.current = null;
    return isDeleted(location);
  }

  return {
    location,
    locationKey,
    activeView,
    navigate,
    openDocument,
    openTreeItemInNewTab,
    handleViewChange,
    forgetDeletedLocation
  };
}
