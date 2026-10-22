import { lineDiff } from "@/shared/lib/lineDiff";
import type { AgentTurnEdit } from "./agentTurn";

/**
 * 본문 안 편집 제안(Figma 1571:27625): 편집안을 원문 위치에 붙여 보여 주려고 문서를 글 조각과 제안 조각으로 나눈다.
 * 제안 하나는 줄 diff에서 이어진 지움·추가 묶음이다. 빈 줄만 바뀐 묶음은 제안으로 세지 않고 편집안을 따른다.
 */
export type EditProposalDecision = "accepted" | "rejected";

export type EditReviewSegment =
  | { kind: "text"; lines: string[] }
  | { kind: "proposal"; index: number; originalLines: string[]; proposedLines: string[] };

export type EditProposalDecisions = Readonly<Record<number, EditProposalDecision>>;

type ReviewableEdit = Pick<AgentTurnEdit, "operation" | "replacement_markdown"> & {
  actual_target: Pick<AgentTurnEdit["actual_target"], "start_line" | "end_line">;
};

const isBlank = (line: string) => line.trim() === "";

function pushText(segments: EditReviewSegment[], lines: string[]) {
  if (lines.length === 0) return;
  const last = segments.at(-1);
  if (last?.kind === "text") {
    segments[segments.length - 1] = { kind: "text", lines: [...last.lines, ...lines] };
    return;
  }
  segments.push({ kind: "text", lines });
}

function pushHunk(segments: EditReviewSegment[], originalLines: string[], proposedLines: string[]) {
  if (originalLines.length === 0 && proposedLines.length === 0) return;
  if ([...originalLines, ...proposedLines].every(isBlank)) {
    pushText(segments, proposedLines);
    return;
  }
  const index = segments.filter((segment) => segment.kind === "proposal").length;
  segments.push({ kind: "proposal", index, originalLines, proposedLines });
}

/** 편집 전 문서와 편집안으로 본문 조각을 만든다. 모두 수락하면 prepareMarkdownEditPreview의 nextMarkdown과 같다. */
export function buildEditReviewSegments(sourceMarkdown: string, edit: ReviewableEdit): EditReviewSegment[] {
  const sourceLines = sourceMarkdown.split("\n");
  const { start_line: startLine, end_line: endLine } = edit.actual_target;
  const replacementLines = edit.replacement_markdown.split("\n");
  const segments: EditReviewSegment[] = [];

  if (edit.operation === "insert_after") {
    pushText(segments, sourceLines.slice(0, endLine));
    pushHunk(segments, [], replacementLines);
    pushText(segments, sourceLines.slice(endLine));
    return segments;
  }

  pushText(segments, sourceLines.slice(0, startLine - 1));
  const originalUnits = toParagraphUnits(sourceLines.slice(startLine - 1, endLine));
  const proposedUnits = toParagraphUnits(replacementLines);
  // 문단 내용을 한 줄 token으로 바꿔 줄 diff를 문단 diff로 쓴다. 뒤따르는 빈 줄 수는 비교하지 않는다.
  const tokens = new Map<string, string>();
  const tokenOf = (unit: string[]) => {
    const key = unit.filter((line) => !isBlank(line)).join("\n");
    if (!tokens.has(key)) tokens.set(key, String(tokens.size));
    return tokens.get(key)!;
  };
  const originalTokens = originalUnits.map(tokenOf).join("\n");
  const proposedTokens = proposedUnits.map(tokenOf).join("\n");
  let originalIndex = 0;
  let proposedIndex = 0;
  let deleted: string[][] = [];
  let inserted: string[][] = [];
  const flushChange = () => {
    // 바뀐 묶음 안에서는 지운 문단과 새 문단을 순서대로 짝지어 문단마다 제안 하나로 둔다.
    for (let index = 0; index < Math.max(deleted.length, inserted.length); index += 1) {
      pushHunk(segments, deleted[index] ?? [], inserted[index] ?? []);
    }
    deleted = [];
    inserted = [];
  };
  for (const line of lineDiff(originalTokens, proposedTokens)) {
    if (line.type === "delete") {
      deleted = [...deleted, originalUnits[originalIndex]];
      originalIndex += 1;
    } else if (line.type === "insert") {
      inserted = [...inserted, proposedUnits[proposedIndex]];
      proposedIndex += 1;
    } else {
      flushChange();
      // 같은 문단이면 편집안 쪽(뒤따르는 빈 줄 포함)을 따른다.
      pushText(segments, proposedUnits[proposedIndex]);
      originalIndex += 1;
      proposedIndex += 1;
    }
  }
  flushChange();
  pushText(segments, sourceLines.slice(endLine));
  return segments;
}

/** 줄을 문단 단위(빈 줄이 아닌 줄 묶음 + 뒤따르는 빈 줄)로 나눈다. 맨 앞 빈 줄은 따로 한 단위가 된다. */
function toParagraphUnits(lines: string[]): string[][] {
  const units: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    const hasContent = current.some((existing) => !isBlank(existing));
    if (!isBlank(line) && hasContent && isBlank(current.at(-1) ?? "")) {
      units.push(current);
      current = [];
    }
    if (!isBlank(line) && !hasContent && current.length > 0) {
      units.push(current);
      current = [];
    }
    current = [...current, line];
  }
  if (current.length > 0) units.push(current);
  return units;
}

export function countProposals(segments: readonly EditReviewSegment[]): number {
  return segments.filter((segment) => segment.kind === "proposal").length;
}

/** 아직 거절·수락하지 않은 제안 수(Figma "제안 N건 진행 중"). */
export function countPendingProposals(segments: readonly EditReviewSegment[], decisions: EditProposalDecisions): number {
  return segments.filter((segment) => segment.kind === "proposal" && !decisions[segment.index]).length;
}

/** 결정하지 않은 제안을 모두 decision으로 채운다(작업 탭 카드의 거절·수락). */
export function settleRemainingProposals(
  segments: readonly EditReviewSegment[],
  decisions: EditProposalDecisions,
  decision: EditProposalDecision
): EditProposalDecisions {
  const settled: Record<number, EditProposalDecision> = { ...decisions };
  for (const segment of segments) {
    if (segment.kind === "proposal" && !settled[segment.index]) settled[segment.index] = decision;
  }
  return settled;
}

export function hasAcceptedProposal(decisions: EditProposalDecisions): boolean {
  return Object.values(decisions).includes("accepted");
}

/** 수락한 제안만 반영한 본문. 결정하지 않은 제안은 원문을 남긴다. */
export function composeReviewedMarkdown(segments: readonly EditReviewSegment[], decisions: EditProposalDecisions): string {
  return segments
    .flatMap((segment) => {
      if (segment.kind === "text") return segment.lines;
      return decisions[segment.index] === "accepted" ? segment.proposedLines : segment.originalLines;
    })
    .join("\n");
}

/** 제안 머리글의 출처(Figma "[제안 : /research-summary]"). 스킬로 보낸 요청이면 "/slug", 아니면 "AI 편집". */
export function proposalSourceLabel(request: string): string {
  const match = request.trim().match(/^\/([^\s/]+)/);
  return match ? `/${match[1]}` : "AI 편집";
}

/** 편집 대상 줄이 속한 제목(Figma 카드 보조 설명의 "연구 개요"). 제목이 없으면 null. */
export function headingAtLine(markdown: string, line: number): string | null {
  const lines = markdown.split("\n").slice(0, Math.max(0, line));
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const heading = lines[index].match(/^ {0,3}#{1,6}[\t ]+(.+?)[\t ]*#*[\t ]*$/);
    if (heading) return heading[1].trim();
  }
  return null;
}
