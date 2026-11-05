import type { GraphLink, GraphNode } from "@/entities/wiki";
import type { GraphIngestProgressInput } from "@/features/wiki-ingest/model/graphIngestProgressInputs";
import { GraphEmptyState } from "./GraphEmptyState";
import { useGraphCanvas } from "../model/useGraphCanvas";
import styles from "./Graph.module.css";

export type GraphCanvasProps = {
  nodes: GraphNode[];
  links: GraphLink[];
  focusedNodeId: string | null;
  onOpenNodePreview: (node: GraphNode) => void;
  onClearNodeFocus?: () => void;
  loading?: boolean;
  errorMessage?: string | null;
  /** 위키 편입 중·실패 문서(selectGraphIngestProgressInputs). 생성 중 진행률 링을 그린다. */
  ingestProgressInputs?: readonly GraphIngestProgressInput[];
  /** 값이 바뀌면 노드가 하나씩 나타나는 연출을 처음부터 다시 재생한다. */
  revealRequest?: number;
};

export function GraphCanvas({
  nodes = [],
  links = [],
  focusedNodeId,
  onOpenNodePreview,
  onClearNodeFocus,
  loading = false,
  errorMessage = null,
  ingestProgressInputs,
  revealRequest
}: GraphCanvasProps) {
  const { canvasRef, graphCanvasProps } = useGraphCanvas({
    nodes,
    links,
    focusedNodeId,
    onOpenNodePreview,
    onClearNodeFocus,
    ingestProgressInputs,
    loading,
    revealRequest
  });

  return (
    <div className={styles["graph-canvas"]} {...graphCanvasProps} style={{ touchAction: "none" }}>
      <canvas ref={canvasRef} className={styles["graph-surface"]} aria-label="자료 관계 그래프 캔버스" />
      {nodes.length === 0 && <GraphEmptyState loading={loading} errorMessage={errorMessage} />}
    </div>
  );
}
