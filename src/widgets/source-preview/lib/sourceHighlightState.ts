import { resolveSourceBlockRanges, type ResolvedSourceBlockRanges } from "@/entities/document/lib/sourceBlockRanges";
import type { DocumentBlocksResponse } from "@/entities/document/model/document";

export const HIGHLIGHT_NOTICES = {
  loadFailed: "근거 위치를 불러오지 못해 본문만 표시합니다.",
  noneLocated: "문서에서 근거 위치를 찾지 못해 본문만 표시합니다.",
  someMissing: "일부 근거는 문서에서 위치를 찾지 못했습니다."
} as const;

export type SourceBlocksQueryState = {
  isEnabled: boolean;
  isPending: boolean;
  isError: boolean;
  /** 현재 본문용 응답을 기다리는 동안 이전 본문 버전의 응답을 임시로 쓰는 중인지 */
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
