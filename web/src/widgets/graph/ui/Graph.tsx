import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useUserPreferences } from "@/entities/user";
import { DEFAULT_USER_PREFERENCES } from "@/entities/user/model/preferences";
import type { GraphFilterKind, GraphNode } from "@/entities/wiki";
import { GraphCanvas, type GraphCanvasProps } from "./GraphCanvas";
import { GraphFilterChips } from "./GraphFilterChips";
import { GraphRefreshButton } from "./GraphRefreshButton";
import styles from "./Graph.module.css";

function nodeFilterKind(node: GraphNode): GraphFilterKind {
  return node.kind === "source" ? "source" : node.kind === "raw" ? "raw" : "concept";
}

export function Graph({
  nodes,
  links,
  rawDocumentCount,
  focusedNodeId,
  onOpenNodePreview,
  onClearNodeFocus,
  loading = false,
  errorMessage = null,
  onRefreshGraph
}: GraphCanvasProps & {
  rawDocumentCount: number;
  /** 있으면 범례 옆에 새로고침 버튼을 둔다. 바뀐 내용이 있었는지 돌려준다. */
  onRefreshGraph?: () => Promise<{ changed: boolean }>;
}) {
  const t = useTranslations("workspace.graph");
  const { preferences, preferencesReady, updatePreferences } = useUserPreferences();
  const [filtersReady, setFiltersReady] = useState(false);
  const [revealRequest, setRevealRequest] = useState(0);

  // 새로 받은 뒤에 노드가 하나씩 나타나는 연출을 다시 재생한다. 바뀐 것이 없어도 재생하고, 실패하면 지금 그래프를 그대로 둔다.
  const refreshGraphWithReveal = useCallback(async () => {
    if (!onRefreshGraph) return { changed: false };
    const result = await onRefreshGraph();
    setRevealRequest((current) => current + 1);
    return result;
  }, [onRefreshGraph]);

  // 그래프에 진입할 때는 이전에 저장한 숨김 설정과 관계없이 모든 종류를 표시한다.
  // 비동기 개인 설정 복원이 끝난 뒤 초기화하여 오래된 설정이 덮어쓰지 않게 한다.
  useEffect(() => {
    if (!preferencesReady) return;
    updatePreferences((current) => ({
      ...current,
      graph: { ...current.graph, visibleKinds: { ...DEFAULT_USER_PREFERENCES.graph.visibleKinds } }
    }));
    setFiltersReady(true);
  }, [preferencesReady, updatePreferences]);
  const sourceNodeCount = nodes.filter((node) => node.kind === "source").length;
  const conceptNodeCount = nodes.filter((node) => !node.kind || node.kind === "concept").length;

  const visibleKinds = filtersReady
    ? preferences.graph.visibleKinds
    : DEFAULT_USER_PREFERENCES.graph.visibleKinds;
  const toggleKind = (kind: GraphFilterKind) => {
    updatePreferences((current) => {
      const nextVisibleKinds = {
        ...current.graph.visibleKinds,
        [kind]: !current.graph.visibleKinds[kind]
      };
      if (!Object.values(nextVisibleKinds).some(Boolean)) return current;
      return {
        ...current,
        graph: { ...current.graph, visibleKinds: nextVisibleKinds }
      };
    });
  };

  // 필터에서 끈 종류의 노드와, 그 노드에 걸린 링크를 렌더 대상에서 제외한다.
  const { visibleNodes, visibleLinks } = useMemo(() => {
    const filteredNodes = nodes.filter((node) => visibleKinds[nodeFilterKind(node)]);
    const visibleIds = new Set(filteredNodes.map((node) => node.id));
    const filteredLinks = links.filter((link) => visibleIds.has(link.from) && visibleIds.has(link.to));
    return { visibleNodes: filteredNodes, visibleLinks: filteredLinks };
  }, [nodes, links, visibleKinds]);

  return (
    <section className={styles["graph-stage"]} aria-label={t("label")}>
      <GraphFilterChips
        rawDocumentCount={rawDocumentCount}
        sourceNodeCount={sourceNodeCount}
        conceptNodeCount={conceptNodeCount}
        visibleKinds={visibleKinds}
        onToggleKind={toggleKind}
      >
        {onRefreshGraph && <GraphRefreshButton onRefresh={refreshGraphWithReveal} />}
      </GraphFilterChips>
      <GraphCanvas
        nodes={visibleNodes}
        links={visibleLinks}
        focusedNodeId={focusedNodeId}
        onOpenNodePreview={onOpenNodePreview}
        onClearNodeFocus={onClearNodeFocus}
        loading={loading}
        errorMessage={errorMessage}
        revealRequest={revealRequest}
      />
    </section>
  );
}
