import { resolveSourceBlockRanges, type ResolvedSourceBlockRanges } from "@/entities/document/lib/sourceBlockRanges";
import type { DocumentBlocksResponse } from "@/entities/document/model/document";

export const HIGHLIGHT_NOTICES = {
  loadFailed: "근거 위치를 불러오지 못해 본문만 표시합니다.",
  noneLocated: "문서에서 근거 위치를 찾지 못해 본문만 표시합니다.",
  someMissing: "일부 근거는 문서에서 위치를 찾지 못했습니다."
} as const;

/** 화면 본문 한 번의 로드. loadId는 문서를 오가도 다시 쓰지 않아 로드마다 고유하다. */
export type MarkdownLoad = { documentId: string; loadId: number };

/** 근거 block 응답과 그 응답을 요청한 본문 로드 */
export type LoadedSourceBlocks = MarkdownLoad & { response: DocumentBlocksResponse };

/**
 * 본문 로드 ID를 매기는 순번을 만든다. 문서를 바꿔도 1부터 다시 세지 않는다.
 * 다시 세면 A→B→A 전환 때 이전 A 로드의 키가 재사용되어 복원 전 응답이 캐시에서 그대로 나온다.
 */
export function createMarkdownLoadSequence(): (documentId: string) => MarkdownLoad {
  let lastLoadId = 0;
  return (documentId) => {
    lastLoadId += 1;
    return { documentId, loadId: lastLoadId };
  };
}

/** 근거 block 조회 키. 본문 로드마다 키가 달라 이전 로드의 응답을 캐시에서 받지 않는다. */
export function getSourceBlocksQueryKey(documentId: string | null | undefined, load: MarkdownLoad | null) {
  return ["document-blocks", documentId, load && load.documentId === documentId ? load.loadId : null] as const;
}

/** 같은 문서를 다시 불러오는 동안에만 이전 응답을 임시로 이어 쓴다. */
export function keepSameDocumentBlocks(
  documentId: string | null | undefined,
  previous: LoadedSourceBlocks | undefined
): LoadedSourceBlocks | undefined {
  return previous && previous.documentId === documentId ? previous : undefined;
}

/**
 * 응답이 현재 본문 로드용인지 가린다.
 * 다른 문서의 응답은 버리고, 같은 문서라도 다른 로드의 응답은 placeholder로 보아 서버 줄 범위를 믿지 않는다.
 * 캐시·placeholder 여부와 무관하게 응답을 요청한 로드 ID로만 판단한다.
 */
export function selectSourceBlocksForLoad(
  load: MarkdownLoad | null,
  loaded: LoadedSourceBlocks | undefined
): Pick<SourceBlocksQueryState, "data" | "isPlaceholderData"> {
  if (!load || !loaded || loaded.documentId !== load.documentId) return { data: undefined, isPlaceholderData: false };
  return { data: loaded.response, isPlaceholderData: loaded.loadId !== load.loadId };
}

export type SourceBlocksQueryState = {
  isEnabled: boolean;
  isPending: boolean;
  isError: boolean;
  /** 현재 본문 로드용 응답이 아니라 이전 로드의 응답을 임시로 쓰는 중인지 */
  isPlaceholderData: boolean;
  data: DocumentBlocksResponse | undefined;
};

export type SourceHighlightStatus = {
  /** block 조회가 끝나야 하이라이트 블록을 그릴 수 있으므로 본문 로딩과 함께 본다. */
  isLoading: boolean;
  notice: string | null;
};

/**
 * 근거 block ID를 현재 본문의 줄 범위로 바꾼다.
 * 이전 본문 버전의 응답(placeholder)은 서버 줄 범위를 믿지 않고 텍스트로만 찾는다.
 */
export function resolveHighlightRanges(
  markdown: string | null,
  query: Pick<SourceBlocksQueryState, "data" | "isPlaceholderData">,
  blockIds: readonly string[]
): ResolvedSourceBlockRanges | null {
  if (markdown === null || !query.data) return null;
  const response = query.isPlaceholderData ? { ...query.data, is_stale: null } : query.data;
  return resolveSourceBlockRanges(markdown, response, blockIds);
}

/**
 * 하이라이트 로딩 여부와 안내 문구를 정한다.
 * - 조회 실패 안내는 보여줄 응답이 없을 때만 낸다. 재조회만 실패하면 남은 응답으로 하이라이트를 그린다.
 * - 이전 본문 버전의 응답(placeholder)으로 찾은 결과는 잠정이라 안내를 보류한다.
 */
export function getSourceHighlightStatus(
  query: SourceBlocksQueryState,
  resolved: ResolvedSourceBlockRanges | null
): SourceHighlightStatus {
  const isLoading = query.isEnabled && query.isPending;
  if (!query.data) return { isLoading, notice: query.isError ? HIGHLIGHT_NOTICES.loadFailed : null };
  if (!resolved || query.isPlaceholderData) return { isLoading, notice: null };
  if (resolved.ranges.length === 0) return { isLoading, notice: HIGHLIGHT_NOTICES.noneLocated };
  if (resolved.missingBlockIds.length > 0) return { isLoading, notice: HIGHLIGHT_NOTICES.someMissing };
  return { isLoading, notice: null };
}
