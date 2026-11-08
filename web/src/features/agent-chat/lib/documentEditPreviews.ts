/**
 * 문서 수정 계획의 변경 내용(edit-previews) 응답과 그 만료·줄 수 계산.
 * API 모듈과 테스트가 직접 import하므로 다른 모듈의 값을 import하지 않는다.
 */
import type { MarkdownDiffLine } from "../../../shared/lib/lineDiff";

export type AgentDocumentEditHunk = { before_start: number; after_start: number; lines: MarkdownDiffLine[] };

export type AgentDocumentEditPreview = {
  operation_id: string;
  tool_name: "apply_document_edit" | "create_document";
  document_id: string | null;
  display_name: string;
  base_version: number | null;
  summary: string;
  added_lines: number;
  removed_lines: number;
  hunks: AgentDocumentEditHunk[];
};

export type AgentRunEditPreviews = { items: AgentDocumentEditPreview[]; expires_at: string | null };

/** 문서당 먼저 보여 주고, "더 보기"를 누를 때마다 더 펼치는 줄 수 */
export const DIFF_LINE_PAGE = 200;

/** setTimeout이 받는 가장 긴 지연. 넘으면 바로 실행된다. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const DIFF_LINE_TYPES: ReadonlySet<string> = new Set(["context", "delete", "insert"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseDiffLines(value: unknown): MarkdownDiffLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter((line): line is MarkdownDiffLine => isRecord(line) && typeof line.text === "string" && DIFF_LINE_TYPES.has(String(line.type)));
}

function parseHunks(value: unknown): AgentDocumentEditHunk[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((hunk) => ({
    before_start: toCount(hunk.before_start),
    after_start: toCount(hunk.after_start),
    lines: parseDiffLines(hunk.lines)
  }));
}

/** edit-previews 응답을 화면이 믿을 수 있는 모양으로 좁힌다. 틀을 벗어나면 실패로 보고, 망가진 항목·줄만 버린다. */
export function parseAgentRunEditPreviews(value: unknown): AgentRunEditPreviews {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("변경 내용 응답 형식이 올바르지 않습니다.");
  const items = value.items.filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.operation_id === "string").map((item) => ({
    operation_id: item.operation_id as string,
    // I5 응답에는 tool_name이 없다. 그 경우에만 기존 apply_document_edit로 해석한다.
    tool_name: item.tool_name === "create_document" ? "create_document" as const : "apply_document_edit" as const,
    document_id: typeof item.document_id === "string" ? item.document_id : null,
    display_name: typeof item.display_name === "string" ? item.display_name : "",
    base_version: item.base_version === null ? null : toCount(item.base_version),
    summary: typeof item.summary === "string" ? item.summary : "",
    added_lines: toCount(item.added_lines),
    removed_lines: toCount(item.removed_lines),
    hunks: parseHunks(item.hunks)
  }));
  return { items, expires_at: typeof value.expires_at === "string" ? value.expires_at : null };
}

/** 만료 시각이 지났는지. 없거나 읽을 수 없으면 막지 않고 서버 판단에 맡긴다. */
export function isEditPreviewExpired(expiresAt: string | null | undefined, now: number): boolean {
  const time = Date.parse(expiresAt ?? "");
  return !Number.isNaN(time) && time <= now;
}

/** 만료까지 남은 시간(타이머용). 이미 지났거나 만료가 없으면 null. */
export function editPreviewExpiryDelayMs(expiresAt: string | null | undefined, now: number): number | null {
  const time = Date.parse(expiresAt ?? "");
  if (Number.isNaN(time) || time <= now) return null;
  return Math.min(time - now, MAX_TIMER_DELAY_MS);
}

/** 줄 수 한도까지만 hunk를 잘라 낸다. 긴 문서를 한 번에 그리지 않는다. */
export function limitDiffHunks(hunks: readonly AgentDocumentEditHunk[], limit: number): { hunks: AgentDocumentEditHunk[]; hiddenLines: number } {
  const visible: AgentDocumentEditHunk[] = [];
  let remaining = limit;
  let hiddenLines = 0;
  for (const hunk of hunks) {
    const shownCount = Math.min(remaining, hunk.lines.length);
    if (shownCount > 0) visible.push(shownCount === hunk.lines.length ? hunk : { ...hunk, lines: hunk.lines.slice(0, shownCount) });
    hiddenLines += hunk.lines.length - shownCount;
    remaining -= shownCount;
  }
  return { hunks: visible, hiddenLines };
}
