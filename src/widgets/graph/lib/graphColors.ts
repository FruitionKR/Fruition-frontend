/**
 * 그래프 캔버스 색상 팔레트.
 * canvas에는 CSS 변수가 직접 먹지 않으므로 테마별 hex를 둔다. 값은 base.css 토큰과 맞춘다.
 * - 라이트: Figma 시안(RaoSahQhmNhzE4XsGAe2LX, 1406:13563) 값
 * - 다크: 기존 다크 전용 그래프 값 유지
 */
export type GraphPalette = {
  sourcePage: string;
  conceptPage: string;
  /** hover/선택 노드와 강조 링크 색 (--color-primary) */
  hoverNode: string;
  /** raw 노드를 아이콘(raw.svg)으로 그릴지. false면 rawNodeFill 단색 원으로 그린다. */
  rawNodeIcon: boolean;
  rawNodeFill: string;
  rawNodeStroke: string;
  rawSourceLink: string;
  rawSourceLinkAlpha: number;
  baseLink: string;
  baseLinkAlpha: number;
  sourceLabelInk: string;
  conceptLabelInk: string;
  rawLabelInk: string;
  /** 중심(선택) 노드 glow 중앙 불투명도 */
  hoverGlowAlpha: number;
  /** 생성 중 노드: 진행률 링, 점선 원, 링크 그라데이션 끝 색 */
  progressRing: string;
  progressTrack: string;
  progressFill: string;
  progressText: string;
  progressLabel: string;
  generatingLinkFrom: string;
  generatingLinkTo: string;
};

const LIGHT_GRAPH_PALETTE: GraphPalette = {
  sourcePage: "#185ac4",
  conceptPage: "#fe9800",
  hoverNode: "#3182f6",
  rawNodeIcon: false,
  rawNodeFill: "#4e5968",
  rawNodeStroke: "#4e5968",
  rawSourceLink: "#4e5968",
  rawSourceLinkAlpha: 1,
  baseLink: "#c3cad2",
  baseLinkAlpha: 1,
  sourceLabelInk: "#21252a",
  conceptLabelInk: "#21252a",
  rawLabelInk: "#4e5968",
  hoverGlowAlpha: 0.2,
  progressRing: "#3182f6",
  progressTrack: "#8b95a1",
  progressFill: "#ffffff",
  progressText: "#21252a",
  progressLabel: "#4e5968",
  generatingLinkFrom: "#3182f6",
  generatingLinkTo: "#8cb7f5"
};

const DARK_GRAPH_PALETTE: GraphPalette = {
  sourcePage: "#bbcf6c",
  conceptPage: "#fffdf0",
  hoverNode: "#ffc117",
  rawNodeIcon: true,
  rawNodeFill: "#4f4f4f",
  rawNodeStroke: "#a7a7a7",
  rawSourceLink: "#5a5a5a",
  rawSourceLinkAlpha: 0.68,
  baseLink: "#4f4f4f",
  baseLinkAlpha: 0.5,
  sourceLabelInk: "#f0f0f0",
  conceptLabelInk: "#8a8a8a",
  rawLabelInk: "#8a8a8a",
  hoverGlowAlpha: 0.24,
  progressRing: "#ffc117",
  progressTrack: "#6b6b6b",
  progressFill: "#0a0a0a",
  progressText: "#f0f0f0",
  progressLabel: "#a7a7a7",
  generatingLinkFrom: "#ffc117",
  generatingLinkTo: "#8a6a10"
};

export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/** OS 색 모드(prefers-color-scheme)에 맞는 그래프 팔레트를 고른다. 렌더 프레임마다 호출된다. */
export function getGraphPalette(): GraphPalette {
  if (typeof window === "undefined" || !window.matchMedia) return LIGHT_GRAPH_PALETTE;
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? DARK_GRAPH_PALETTE : LIGHT_GRAPH_PALETTE;
}

/** "#rrggbb" hex를 [r, g, b] 정수 배열로 변환한다. */
export function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16)
  ];
}

/** 두 hex 색을 amount(0~1) 비율로 선형 보간해 "rgb(...)" 문자열을 만든다. */
export function mixHexColor(from: string, to: string, amount: number): string {
  const fromRgb = hexToRgb(from);
  const toRgb = hexToRgb(to);
  const red = Math.round(fromRgb[0] + (toRgb[0] - fromRgb[0]) * amount);
  const green = Math.round(fromRgb[1] + (toRgb[1] - fromRgb[1]) * amount);
  const blue = Math.round(fromRgb[2] + (toRgb[2] - fromRgb[2]) * amount);
  return `rgb(${red}, ${green}, ${blue})`;
}
