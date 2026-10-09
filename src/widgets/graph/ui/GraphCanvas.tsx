import type { GraphLink, GraphNode } from "@/entities/wiki";
import type { GraphIngestProgressInput } from "@/features/wiki-ingest/model/graphIngestProgressInputs";
import { GraphEmptyState } from "./GraphEmptyState";
import { useGraphCanvas } from "../model/useGraphCanvas";
import styles from "./Graph.module.css";

export function GraphCanvas({
  nodes = [],
  links = [],
  focusedNodeId,
  onOpenNodePreview,
  onClearNodeFocus,
  loading = false,
  errorMessage = null,
  ingestProgressInputs
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  focusedNodeId: string | null;
  onOpenNodePreview: (node: GraphNode) => void;
  onClearNodeFocus?: () => void;
  loading?: boolean;
  errorMessage?: string | null;
  ingestProgressInputs?: readonly GraphIngestProgressInput[];
}) {
  const { canvasRef, graphCanvasProps } = useGraphCanvas({
    nodes,
    links,
    focusedNodeId,
    onOpenNodePreview,
    onClearNodeFocus,
    ingestProgressInputs
  });

  return (
    <div className={styles["graph-canvas"]} {...graphCanvasProps} style={{ touchAction: "none" }}>
      <canvas ref={canvasRef} className={styles["graph-surface"]} aria-label="자료 관계 그래프 캔버스" />
      {nodes.length === 0 && <GraphEmptyState loading={loading} errorMessage={errorMessage} />}
    </div>
  );
}
