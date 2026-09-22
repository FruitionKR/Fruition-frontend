import { useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/entities/user";
import { DEFAULT_USER_PREFERENCES } from "@/entities/user/model/preferences";
import type { GraphFilterKind, GraphLink, GraphNode } from "@/entities/wiki";
import { GraphCanvas } from "./GraphCanvas";
import { GraphFilterChips } from "./GraphFilterChips";
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
  errorMessage = null
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  rawDocumentCount: number;
  focusedNodeId: string | null;
  onOpenNodePreview: (node: GraphNode) => void;
  onClearNodeFocus?: () => void;
  loading?: boolean;
  errorMessage?: string | null;
}) {
  const { preferences, preferencesReady, updatePreferences } = useUserPreferences();
  const [filtersReady, setFiltersReady] = useState(false);

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
    <section className={styles["graph-stage"]} aria-label="자료 관계 그래프">
      <GraphFilterChips
        rawDocumentCount={rawDocumentCount}
        sourceNodeCount={sourceNodeCount}
        conceptNodeCount={conceptNodeCount}
        visibleKinds={visibleKinds}
        onToggleKind={toggleKind}
      />
      <GraphCanvas
        nodes={visibleNodes}
        links={visibleLinks}
        focusedNodeId={focusedNodeId}
        onOpenNodePreview={onOpenNodePreview}
        onClearNodeFocus={onClearNodeFocus}
        loading={loading}
        errorMessage={errorMessage}
      />
    </section>
  );
}
