import type { GraphLink, GraphNode, NodePosition } from "@/entities/wiki";
import { getGraphPalette, hexToRgb, mixHexColor, type GraphPalette } from "./graphColors";
import rawNodeIcon from "@/shared/assets/svg/graph/raw.svg";

const RAW_NODE_ICON_SRC = rawNodeIcon.src;

// 선택(중심) 마커 geometry 값 (Figma 1406:15779 "round": glow 지름 158, 중심 원 지름 18)
const SELECTED_MARKER_OUTER_RADIUS = 79;
const SELECTED_MARKER_INNER_RADIUS = 9;

// 링크 선 geometry (Figma: 일반 링크 1.4px 실선, raw-source 링크 1.6px 점선)
const BASE_LINK_WIDTH = 1.4;
const RAW_SOURCE_LINK_WIDTH = 1.6;
const RAW_SOURCE_LINK_DASH = [3, 2.5];
const GENERATING_LINK_DASH = [4, 3];

// 생성 중 노드 geometry (Figma 1406:15752: 52px 진행률 링, 34px 점선 원)
const PROGRESS_RING_RADIUS = 23.4;
const PROGRESS_RING_WIDTH = 5.2;
const PROGRESS_TRACK_RADIUS = 17;
const PROGRESS_LABEL_OFFSET = 43;

/** 생성 중인 노드. progress(0~1)가 있으면 진행률 링으로 그린다. */
type GeneratingGraphNode = GraphNode & { progress?: number };

function nodeProgress(node: GraphNode | undefined, getNodeProgress?: (nodeId: string) => number | undefined): number | null {
  const progress = (node && getNodeProgress?.(node.id)) ?? (node as GeneratingGraphNode | undefined)?.progress;
  return typeof progress === "number" ? Math.min(1, Math.max(0, progress)) : null;
}

let rawNodeImage: HTMLImageElement | null = null;

export function drawGraphFrame({
  canvas,
  nodes,
  links,
  visibleNodeCount,
  getNodePosition,
  nodeHoverAmounts,
  graphToCanvas,
  nodeSize,
  isRawSourceLink,
  getNodeProgress
}: {
  canvas: HTMLCanvasElement;
  nodes: GraphNode[];
  links: GraphLink[];
  visibleNodeCount: number;
  getNodePosition: (nodeId: string) => NodePosition;
  nodeHoverAmounts: Record<string, number>;
  graphToCanvas: (position: NodePosition, canvas: HTMLCanvasElement) => NodePosition;
  nodeSize: (node: GraphNode) => number;
  isRawSourceLink: (link: GraphLink) => boolean;
  /** 연출형 진행률(0~1). 값이 있으면 node.progress보다 우선한다. */
  getNodeProgress?: (nodeId: string) => number | undefined;
}) {
  ensureCanvasSize(canvas);
  const pixelRatio = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;

  const context = canvas.getContext("2d");
  if (!context) return;

  const palette = getGraphPalette();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const drawableNodeCount = Math.min(visibleNodeCount, nodes.length);
  const visibleNodeIds = new Set(nodes.slice(0, drawableNodeCount).map((node) => node.id));
  const { linkedHoverAmounts, activeHoverAmount } = computeLinkedHoverAmounts({
    nodes,
    links,
    drawableNodeCount,
    visibleNodeIds,
    nodeHoverAmounts
  });

  function focusAmountFromHover(hoverAmount: number) {
    return Math.min(1, Math.max(0, 1 - activeHoverAmount + hoverAmount));
  }

  for (const link of links) {
    if (!visibleNodeIds.has(link.from) || !visibleNodeIds.has(link.to)) continue;
    const from = getNodePosition(link.from);
    const to = getNodePosition(link.to);
    const fromScreen = graphToCanvas(from, canvas);
    const toScreen = graphToCanvas(to, canvas);
    const rawSourceLink = isRawSourceLink(link);
    const generatingLink =
      nodeProgress(nodeById.get(link.from), getNodeProgress) !== null || nodeProgress(nodeById.get(link.to), getNodeProgress) !== null;
    const baseAlpha = generatingLink ? 1 : rawSourceLink ? palette.rawSourceLinkAlpha : palette.baseLinkAlpha;
    const fadedAlpha = rawSourceLink || generatingLink ? 0.14 : 0.08;
    const linkHoverAmount = Math.max(nodeHoverAmounts[link.from] ?? 0, nodeHoverAmounts[link.to] ?? 0);
    const focusAmount = focusAmountFromHover(linkHoverAmount);

    context.save();
    context.globalAlpha = fadedAlpha + (baseAlpha - fadedAlpha) * focusAmount;
    context.beginPath();
    context.moveTo(fromScreen.x, fromScreen.y);
    context.lineTo(toScreen.x, toScreen.y);
    if (generatingLink) {
      // 생성 중 노드로 가는 링크: primary 그라데이션 점선 (생성 중 쪽이 옅다)
      const generatingAtEnd = nodeProgress(nodeById.get(link.to), getNodeProgress) !== null;
      const gradient = context.createLinearGradient(fromScreen.x, fromScreen.y, toScreen.x, toScreen.y);
      gradient.addColorStop(0, generatingAtEnd ? palette.generatingLinkFrom : palette.generatingLinkTo);
      gradient.addColorStop(1, generatingAtEnd ? palette.generatingLinkTo : palette.generatingLinkFrom);
      context.setLineDash(GENERATING_LINK_DASH);
      context.lineWidth = RAW_SOURCE_LINK_WIDTH;
      context.strokeStyle = gradient;
    } else {
      context.setLineDash(link.dashed ? RAW_SOURCE_LINK_DASH : []);
      context.lineWidth = rawSourceLink ? RAW_SOURCE_LINK_WIDTH : BASE_LINK_WIDTH;
      context.strokeStyle = rawSourceLink ? palette.rawSourceLink : palette.baseLink;
    }
    context.stroke();

    if (linkHoverAmount > 0.01) {
      context.globalAlpha = 0.98 * linkHoverAmount;
      context.setLineDash([]);
      context.lineWidth = 2.6;
      context.strokeStyle = palette.hoverNode;
      context.beginPath();
      context.moveTo(fromScreen.x, fromScreen.y);
      context.lineTo(toScreen.x, toScreen.y);
      context.stroke();
    }

    context.restore();
  }
  context.setLineDash([]);

  for (let index = 0; index < drawableNodeCount; index += 1) {
    const node = nodes[index];
    const position = getNodePosition(node.id);
    const screenPosition = graphToCanvas(position, canvas);
    const radius = nodeSize(node) / 2;
    const hoverAmount = nodeHoverAmounts[node.id] ?? 0;
    const focusAmount = focusAmountFromHover(linkedHoverAmounts.get(node.id) ?? 0);
    const nodeAlpha = 0.16 + 0.84 * focusAmount;

    context.save();
    context.globalAlpha = nodeAlpha;

    const progress = nodeProgress(node, getNodeProgress);
    if (progress !== null) {
      drawGeneratingNode(context, palette, node, screenPosition.x, screenPosition.y, progress);
      context.restore();
      continue;
    }

    if (hoverAmount > 0.01) {
      drawSelectedNodeMarker(context, palette, screenPosition.x, screenPosition.y, hoverAmount);
      context.globalAlpha = nodeAlpha;
    }

    context.beginPath();
    context.arc(screenPosition.x, screenPosition.y, radius, 0, Math.PI * 2);
    if (node.kind === "source") {
      context.fillStyle = mixHexColor(palette.sourcePage, palette.hoverNode, hoverAmount);
      context.fill();
    } else if (node.kind === "raw") {
      const rawImage = palette.rawNodeIcon ? getRawNodeImage() : null;
      if (rawImage) {
        const imageSize = Math.max(12, radius * 2);
        context.drawImage(rawImage, screenPosition.x - imageSize / 2, screenPosition.y - imageSize / 2, imageSize, imageSize);
      } else {
        context.fillStyle = palette.rawNodeFill;
        context.fill();
        if (palette.rawNodeIcon) {
          // 다크: 아이콘 로드 전 폴백으로 같은 모양(점선 테두리)을 벡터로 그린다.
          context.strokeStyle = palette.rawNodeStroke;
          context.lineWidth = 1.2;
          context.setLineDash([3, 2.5]);
          context.stroke();
          context.setLineDash([]);
        }
      }

      context.fillStyle = palette.hoverNode;
      context.globalAlpha = nodeAlpha * hoverAmount;
      context.fill();
      context.globalAlpha = nodeAlpha;
    } else {
      context.fillStyle = mixHexColor(palette.conceptPage, palette.hoverNode, hoverAmount);
      context.fill();
    }

    drawNodeLabel(context, palette, node, screenPosition.x, screenPosition.y);
    context.restore();
  }
}

/** canvas 크기를 devicePixelRatio에 맞춰 갱신한다. 크기가 바뀌었으면 true를 반환한다. */
function ensureCanvasSize(canvas: HTMLCanvasElement): boolean {
  const pixelRatio = window.devicePixelRatio || 1;
  const nextWidth = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
  const nextHeight = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
  if (canvas.width === nextWidth && canvas.height === nextHeight) return false;

  canvas.width = nextWidth;
  canvas.height = nextHeight;
  return true;
}

/** 링크로 연결된 노드까지 hover 강도를 전파해 노드별 최대값과 전체 최대값을 계산한다. */
function computeLinkedHoverAmounts({
  nodes,
  links,
  drawableNodeCount,
  visibleNodeIds,
  nodeHoverAmounts
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  drawableNodeCount: number;
  visibleNodeIds: Set<string>;
  nodeHoverAmounts: Record<string, number>;
}) {
  const linkedHoverAmounts = new Map<string, number>();
  let activeHoverAmount = 0;

  nodes.slice(0, drawableNodeCount).forEach((node) => {
    const hoverAmount = nodeHoverAmounts[node.id] ?? 0;
    linkedHoverAmounts.set(node.id, hoverAmount);
    activeHoverAmount = Math.max(activeHoverAmount, hoverAmount);
  });

  links.forEach((link) => {
    if (!visibleNodeIds.has(link.from) || !visibleNodeIds.has(link.to)) return;
    const fromHoverAmount = nodeHoverAmounts[link.from] ?? 0;
    const toHoverAmount = nodeHoverAmounts[link.to] ?? 0;

    linkedHoverAmounts.set(
      link.from,
      Math.max(linkedHoverAmounts.get(link.from) ?? 0, fromHoverAmount, toHoverAmount)
    );
    linkedHoverAmounts.set(
      link.to,
      Math.max(linkedHoverAmounts.get(link.to) ?? 0, fromHoverAmount, toHoverAmount)
    );
  });

  return { linkedHoverAmounts, activeHoverAmount };
}

// 라벨 서체 (Figma: Pretendard Medium — source 14px, concept 12px, raw 10px)
const LABEL_FONT_FAMILY = "\"Fruition Chat Pretendard\", Pretendard, Inter, sans-serif";

export function drawNodeLabel(context: CanvasRenderingContext2D, palette: GraphPalette, node: GraphNode, x: number, y: number) {
  const labelY = node.kind === "source" ? y + 24 : node.kind === "raw" ? y + 15 : y + 20;
  context.font = node.kind === "source"
    ? `500 14px ${LABEL_FONT_FAMILY}`
    : node.kind === "raw"
      ? `500 10px ${LABEL_FONT_FAMILY}`
      : `500 12px ${LABEL_FONT_FAMILY}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = node.kind === "source"
    ? palette.sourceLabelInk
    : node.kind === "raw"
      ? palette.rawLabelInk
      : palette.conceptLabelInk;
  context.fillText(node.label, x, labelY);
}

/** 생성 중 노드: 점선 원 + 진행률 링 + 퍼센트 + 제목 (Figma 1406:15752) */
function drawGeneratingNode(
  context: CanvasRenderingContext2D,
  palette: GraphPalette,
  node: GraphNode,
  x: number,
  y: number,
  progress: number
) {
  context.beginPath();
  context.arc(x, y, PROGRESS_TRACK_RADIUS, 0, Math.PI * 2);
  context.fillStyle = palette.progressFill;
  context.fill();
  context.setLineDash([3, 3]);
  context.lineWidth = 1;
  context.strokeStyle = palette.progressTrack;
  context.stroke();
  context.setLineDash([]);

  if (progress > 0) {
    // 12시 방향에서 반시계 방향으로 진행률만큼 채운다.
    const start = -Math.PI / 2;
    context.beginPath();
    context.arc(x, y, PROGRESS_RING_RADIUS, start, start - Math.PI * 2 * progress, true);
    context.lineWidth = PROGRESS_RING_WIDTH;
    context.lineCap = "round";
    context.strokeStyle = palette.progressRing;
    context.stroke();
    context.lineCap = "butt";
  }

  // "58%" — 숫자 12px, % 8px SemiBold
  const percentText = String(Math.round(progress * 100));
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  context.fillStyle = palette.progressText;
  context.font = `600 12px ${LABEL_FONT_FAMILY}`;
  const numberWidth = context.measureText(percentText).width;
  context.font = `600 8px ${LABEL_FONT_FAMILY}`;
  const percentWidth = context.measureText("%").width;
  const textLeft = x - (numberWidth + percentWidth) / 2;
  const baseline = y + 4;
  context.font = `600 12px ${LABEL_FONT_FAMILY}`;
  context.fillText(percentText, textLeft, baseline);
  context.font = `600 8px ${LABEL_FONT_FAMILY}`;
  context.fillText("%", textLeft + numberWidth, baseline);

  context.font = `500 14px ${LABEL_FONT_FAMILY}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = palette.progressLabel;
  context.fillText(node.label, x, y + PROGRESS_LABEL_OFFSET);
}

function drawSelectedNodeMarker(context: CanvasRenderingContext2D, palette: GraphPalette, x: number, y: number, opacity: number) {
  const outerRadius = SELECTED_MARKER_OUTER_RADIUS;
  const innerRadius = SELECTED_MARKER_INNER_RADIUS;
  const gradient = context.createRadialGradient(x, y, 0, x, y, outerRadius);
  const glowRgb = hexToRgb(palette.hoverNode).join(", ");

  gradient.addColorStop(0, `rgba(${glowRgb}, ${palette.hoverGlowAlpha})`);
  gradient.addColorStop(1, `rgba(${glowRgb}, 0)`);

  context.globalAlpha = opacity;
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, outerRadius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = palette.hoverNode;
  context.beginPath();
  context.arc(x, y, innerRadius, 0, Math.PI * 2);
  context.fill();
}

/**
 * raw 노드 아이콘을 미리 로드한다. 로드가 끝나면 onReady로 재드로우를 요청해
 * 시뮬레이션이 이미 안정된 뒤에도 폴백 벡터로 남지 않게 한다.
 */
export function preloadRawNodeIcon(onReady: () => void) {
  if (typeof window === "undefined" || rawNodeImage) return;

  const image = new window.Image();
  rawNodeImage = image;
  image.onload = onReady;
  image.src = RAW_NODE_ICON_SRC;
}

function getRawNodeImage() {
  return rawNodeImage?.complete ? rawNodeImage : null;
}
