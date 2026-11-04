import type { GraphLink, GraphNode, NodePosition } from "@/entities/wiki";
import { getGraphPalette, hexToRgb, mixHexColor, type GraphPalette } from "./graphColors";
import type { NodeEntryFrame } from "./graphEnter";
import { isSmallGraphViewport, pickVisibleLabels } from "./graphLabelVisibility";
import rawNodeIcon from "@/shared/assets/svg/graph/raw-document-node.svg";

const RAW_NODE_ICON_SRC = rawNodeIcon.src;

// 선택(중심) 마커 geometry 값 (Figma 1406:15779 "round": glow 지름 158, 중심 원 지름 18)
const SELECTED_MARKER_OUTER_RADIUS = 79;
const SELECTED_MARKER_INNER_RADIUS = 9;

// 링크 선 geometry (Figma: 일반 링크 1.4px 실선, raw-source 링크 1.6px 점선)
const BASE_LINK_WIDTH = 1.4;
const RAW_SOURCE_LINK_WIDTH = 1.6;
const RAW_SOURCE_LINK_DASH = [3, 2.5];
const GENERATING_LINK_DASH = [4, 3];

// 새 노드 강조 geometry: 노드 바깥 광채 폭과 링 간격
const NEW_NODE_GLOW_WIDTH = 22;
const NEW_NODE_RING_GAP = 5;

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
  getNodeProgress,
  getNodeEntry,
  getLinkOpacity
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
  /** 첫 렌더 뒤 추가돼 등장 중인 노드의 이번 프레임 모습. null이면 평소대로 그린다. */
  getNodeEntry?: (nodeId: string) => NodeEntryFrame | null;
  /** 전체 등장 연출 중인 링크의 불투명도 배수(0~1). 없으면 1이다. */
  getLinkOpacity?: (link: GraphLink) => number;
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
    const linkOpacity = getLinkOpacity?.(link) ?? 1;
    if (linkOpacity <= 0) continue;
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
    // 새 노드로 가는 링크는 먼저 자리 잡은 끝에서 새 노드 쪽으로 뻗어 나간다(덜 진행된 쪽이 나중에 온 노드).
    const fromEntry = getNodeEntry?.(link.from) ?? null;
    const toEntry = getNodeEntry?.(link.to) ?? null;
    const growsTowardFrom = fromEntry !== null && (toEntry === null || fromEntry.edge < toEntry.edge);
    const linkGrowth = (growsTowardFrom ? fromEntry : toEntry)?.edge ?? 1;
    if (linkGrowth <= 0) continue;
    const lineStart = growsTowardFrom ? lerpPosition(toScreen, fromScreen, linkGrowth) : fromScreen;
    const lineEnd = growsTowardFrom ? toScreen : lerpPosition(fromScreen, toScreen, linkGrowth);

    context.save();
    context.globalAlpha = (fadedAlpha + (baseAlpha - fadedAlpha) * focusAmount) * linkOpacity;
    context.beginPath();
    context.moveTo(lineStart.x, lineStart.y);
    context.lineTo(lineEnd.x, lineEnd.y);
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
      context.globalAlpha = 0.98 * linkHoverAmount * linkOpacity;
      context.setLineDash([]);
      context.lineWidth = 2.6;
      context.strokeStyle = palette.hoverNode;
      context.beginPath();
      context.moveTo(lineStart.x, lineStart.y);
      context.lineTo(lineEnd.x, lineEnd.y);
      context.stroke();
    }

    context.restore();
  }
  context.setLineDash([]);

  // 새 노드 광채 그라데이션은 반지름별로 원점 기준 하나만 만들어 이번 프레임 안에서 다시 쓴다.
  const glowGradients = new Map<number, CanvasGradient>();
  // 작은 화면에서는 고정 크기 라벨이 서로 겹치므로 겹치지 않는 것만 그린다. 누른 노드의 라벨은 항상 먼저 놓는다.
  const visibleLabelIds = isSmallGraphViewport({ width: cssWidth, height: cssHeight })
    ? pickVisibleLabels(nodes.slice(0, drawableNodeCount).filter((node) => (getNodeEntry?.(node.id)?.opacity ?? 1) > 0).map((node) => {
      const { x, y } = graphToCanvas(getNodePosition(node.id), canvas);
      return measureNodeLabel(context, node, x, y, nodeHoverAmounts[node.id] ?? 0);
    }))
    : null;
  for (let index = 0; index < drawableNodeCount; index += 1) {
    const node = nodes[index];
    const position = getNodePosition(node.id);
    const screenPosition = graphToCanvas(position, canvas);
    const radius = nodeSize(node) / 2;
    const hoverAmount = nodeHoverAmounts[node.id] ?? 0;
    const focusAmount = focusAmountFromHover(linkedHoverAmounts.get(node.id) ?? 0);
    const entry = getNodeEntry?.(node.id) ?? null;
    const entryOpacity = entry?.opacity ?? 1;
    if (entryOpacity <= 0) continue;
    const focusAlpha = 0.16 + 0.84 * focusAmount;
    const nodeAlpha = focusAlpha * entryOpacity;

    context.save();
    if (entry && entry.glow > 0) {
      drawNewNodeHighlight(context, palette, screenPosition.x, screenPosition.y, radius, entry, focusAlpha, glowGradients);
    }
    context.globalAlpha = nodeAlpha;
    if (entry && entry.scale !== 1) {
      // 노드 중심을 기준으로 작게 시작해 살짝 넘쳤다가 원래 크기로 돌아온다(라벨·마커 포함).
      scaleAround(context, screenPosition, entry.scale);
    }

    const progress = nodeProgress(node, getNodeProgress);
    if (progress !== null) {
      drawGeneratingNode(context, palette, node, screenPosition.x, screenPosition.y, progress);
      context.restore();
      continue;
    }

    if (hoverAmount > 0.01) {
      drawSelectedNodeMarker(context, palette, screenPosition.x, screenPosition.y, hoverAmount * entryOpacity);
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

    context.restore();
  }

  // 라벨은 모든 노드를 그린 뒤에 그린다. 함께 그리면 뒤에 그린 노드가 앞 노드의 라벨을 가린다.
  for (let index = 0; index < drawableNodeCount; index += 1) {
    const node = nodes[index];
    const entry = getNodeEntry?.(node.id) ?? null;
    if ((entry?.opacity ?? 1) <= 0 || nodeProgress(node, getNodeProgress) !== null) continue;
    if (visibleLabelIds && !visibleLabelIds.has(node.id)) continue;
    const screenPosition = graphToCanvas(getNodePosition(node.id), canvas);
    context.save();
    // 새 노드의 라벨은 노드가 핀 뒤에 따라 나타난다.
    context.globalAlpha = (0.16 + 0.84 * focusAmountFromHover(linkedHoverAmounts.get(node.id) ?? 0)) * (entry?.label ?? 1);
    if (entry && entry.scale !== 1) scaleAround(context, screenPosition, entry.scale);
    drawNodeLabel(context, palette, node, screenPosition.x, screenPosition.y);
    context.restore();
  }
}

/** 노드 중심을 기준으로 키운다. 노드와 라벨이 함께 커진다. */
function scaleAround(context: CanvasRenderingContext2D, center: NodePosition, scale: number) {
  context.translate(center.x, center.y);
  context.scale(scale, scale);
  context.translate(-center.x, -center.y);
}

function lerpPosition(from: NodePosition, to: NodePosition, amount: number): NodePosition {
  return { x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount };
}

/** 새로 들어온 노드 강조: 옅은 광채와 얇은 링. 동작 줄이기면 움직임 없는 링만 그린다. */
function drawNewNodeHighlight(
  context: CanvasRenderingContext2D,
  palette: GraphPalette,
  x: number,
  y: number,
  radius: number,
  entry: NodeEntryFrame,
  focusAlpha: number,
  glowGradients: Map<number, CanvasGradient>
) {
  context.save();
  if (!entry.staticRing) {
    const outerRadius = radius + NEW_NODE_GLOW_WIDTH;
    let gradient = glowGradients.get(radius);
    if (!gradient) {
      const glowRgb = hexToRgb(palette.hoverNode).join(", ");
      gradient = context.createRadialGradient(0, 0, radius, 0, 0, outerRadius);
      gradient.addColorStop(0, `rgba(${glowRgb}, ${palette.hoverGlowAlpha})`);
      gradient.addColorStop(1, `rgba(${glowRgb}, 0)`);
      glowGradients.set(radius, gradient);
    }
    context.globalAlpha = focusAlpha * entry.glow;
    context.fillStyle = gradient;
    // 원점 기준 그라데이션을 노드 위치로 옮겨 칠한다(노드마다 새로 만들지 않는다).
    context.translate(x, y);
    context.beginPath();
    context.arc(0, 0, outerRadius, 0, Math.PI * 2);
    context.fill();
    context.translate(-x, -y);
  }
  context.globalAlpha = focusAlpha * (entry.staticRing ? 0.85 : 0.7 * entry.glow);
  context.strokeStyle = palette.hoverNode;
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(x, y, radius + NEW_NODE_RING_GAP, 0, Math.PI * 2);
  context.stroke();
  context.restore();
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

function labelStyle(node: GraphNode) {
  if (node.kind === "source") return { offset: 24, size: 14, priority: 2 };
  if (node.kind === "raw") return { offset: 15, size: 10, priority: 0 };
  return { offset: 20, size: 12, priority: 1 };
}

function labelFont(size: number) {
  return `500 ${size}px ${LABEL_FONT_FAMILY}`;
}

function measureNodeLabel(context: CanvasRenderingContext2D, node: GraphNode, x: number, y: number, hoverAmount: number) {
  const { offset, size, priority } = labelStyle(node);
  context.font = labelFont(size);
  const halfWidth = context.measureText(node.label).width / 2;
  const labelY = y + offset;
  return { id: node.id, left: x - halfWidth, right: x + halfWidth, top: labelY - size / 2, bottom: labelY + size / 2, priority: priority + (hoverAmount > 0 ? 3 : 0) };
}

function drawNodeLabel(context: CanvasRenderingContext2D, palette: GraphPalette, node: GraphNode, x: number, y: number) {
  const { offset, size } = labelStyle(node);
  const labelY = y + offset;
  context.font = labelFont(size);
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
