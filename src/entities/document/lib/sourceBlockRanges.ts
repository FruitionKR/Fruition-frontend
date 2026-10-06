import type { SourceBlockRange } from "@/shared/lib/markdownSourceBlocks";
import type { DocumentBlocksResponse, DocumentSourceBlock } from "@/entities/document/model/document";

export type ResolvedSourceBlockRanges = {
  ranges: SourceBlockRange[];
  /** 서버 목록에 없거나 현재 본문에서 위치를 찾지 못한 block ID */
  missingBlockIds: string[];
};

type NormalizedMarkdown = {
  text: string;
  /** 정규화 문자열의 각 글자가 있던 원문 줄 번호(1부터) */
  lineOf: number[];
  /** 그 글자가 원문 줄의 첫/마지막 비공백 글자인지 */
  isLineFirst: boolean[];
  isLineLast: boolean[];
};

const WHITESPACE = /\s/;

/** 서버 normalize_space와 같은 규칙: 공백 연속을 한 칸으로 줄이고 양끝을 자른다. */
export function normalizeBlockText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeMarkdown(markdown: string): NormalizedMarkdown {
  const chars: string[] = [];
  const lineOf: number[] = [];
  const isLineFirst: boolean[] = [];
  const isLineLast: boolean[] = [];
  let line = 1;
  let pendingSpace = false;
  let lineHasText = false;

  // UTF-16 단위로 돈다. indexOf 결과 인덱스와 단위를 맞추기 위해서다.
  for (const char of markdown.split("")) {
    if (char === "\n") {
      if (lineHasText) isLineLast[isLineLast.length - 1] = true;
      line += 1;
      lineHasText = false;
      pendingSpace = chars.length > 0;
      continue;
    }
    if (WHITESPACE.test(char)) {
      pendingSpace = chars.length > 0;
      continue;
    }
    if (pendingSpace) {
      chars.push(" ");
      lineOf.push(line);
      isLineFirst.push(false);
      isLineLast.push(false);
      pendingSpace = false;
    }
    chars.push(char);
    lineOf.push(line);
    isLineFirst.push(!lineHasText);
    isLineLast.push(false);
    lineHasText = true;
  }
  if (lineHasText) isLineLast[isLineLast.length - 1] = true;

  return { text: chars.join(""), lineOf, isLineFirst, isLineLast };
}

/** 줄 경계에 맞는 일치 위치들. AI block은 항상 줄 단위라 줄 중간 부분 일치는 버린다. */
function findLineAlignedMatches(normalized: NormalizedMarkdown, needle: string) {
  const matches: SourceBlockRange[] = [];
  if (!needle) return matches;
  let found = normalized.text.indexOf(needle);
  while (found >= 0) {
    const end = found + needle.length - 1;
    if (normalized.isLineFirst[found] && normalized.isLineLast[end]) {
      matches.push({ blockId: "", startLine: normalized.lineOf[found], endLine: normalized.lineOf[end] });
    }
    found = normalized.text.indexOf(needle, found + 1);
  }
  return matches;
}

function hasTrustedLineRange(block: DocumentSourceBlock, lineCount: number) {
  const { line_start: start, line_end: end } = block;
  return Number.isInteger(start)
    && Number.isInteger(end)
    && (start as number) >= 1
    && (start as number) <= (end as number)
    && (end as number) <= lineCount;
}

function closestMatch(matches: SourceBlockRange[], hintLine: number | null | undefined) {
  if (!Number.isInteger(hintLine)) return matches[0];
  return matches.reduce((best, match) =>
    Math.abs(match.startLine - (hintLine as number)) < Math.abs(best.startLine - (hintLine as number)) ? match : best
  );
}

/**
 * 근거 block ID를 현재 본문의 줄 범위로 바꾼다.
 * 스냅샷이 현재 본문과 같다고 확인된 경우(is_stale === false)에만 서버 줄 범위를 그대로 쓰고,
 * 그 외(수정됨·판단 불가·구 응답·범위 없음)에는 정규화 텍스트로 현재 본문에서 찾는다.
 */
export function resolveSourceBlockRanges(
  markdown: string,
  response: Pick<DocumentBlocksResponse, "is_stale" | "blocks">,
  blockIds: readonly string[]
): ResolvedSourceBlockRanges {
  const lineCount = markdown.split("\n").length;
  const isSnapshotCurrent = response.is_stale === false;
  const blockById = new Map(response.blocks.map((block) => [block.block_id, block]));
  let normalized: NormalizedMarkdown | null = null;
  const ranges: SourceBlockRange[] = [];
  const missingBlockIds: string[] = [];

  for (const blockId of new Set(blockIds)) {
    const block = blockById.get(blockId);
    if (!block) {
      missingBlockIds.push(blockId);
      continue;
    }
    if (isSnapshotCurrent && hasTrustedLineRange(block, lineCount)) {
      ranges.push({ blockId, startLine: block.line_start as number, endLine: block.line_end as number });
      continue;
    }
    normalized ??= normalizeMarkdown(markdown);
    const matches = findLineAlignedMatches(normalized, normalizeBlockText(block.text ?? ""));
    if (matches.length === 0) {
      missingBlockIds.push(blockId);
      continue;
    }
    const match = closestMatch(matches, block.line_start);
    ranges.push({ blockId, startLine: match.startLine, endLine: match.endLine });
  }

  return { ranges, missingBlockIds };
}
