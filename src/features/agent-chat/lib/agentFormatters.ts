import type { ChatMessageReferenceResponse } from "@/entities/chat/model/chat";
import type { GraphNode } from "@/entities/wiki/model/wiki";

/** 첫 글자만 대문자로 바꾼다. */
export function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

/**
 * wiki page id로 표시용 제목을 만든다.
 * 그래프 노드 라벨이 있으면 우선 사용하고, 없으면 slug를 Title Case로 변환한다.
 */
export function formatWikiPageTitle(
  pageId: string | undefined,
  nodes: GraphNode[] | undefined,
  fallback = "근거"
): string {
  if (!pageId) return fallback;
  if (nodes) {
    const node = nodes.find((n) => n.id === pageId);
    if (node?.label) return node.label;
  }
  const [, slug = pageId] = pageId.split(":");
  return slug
    .split("-")
    .filter(Boolean)
    .map(capitalize)
    .join(" ");
}

// 답변에 새어 나오는 내부 블록 참조. B번호 부분은 백엔드 계약
// (pipeline query/application/source_references.py의 `(?:[A-Za-z0-9_.-]+:)?B\d{4}`)과 동일하게
// 접두사(원본 문서명)를 임의·생략 가능으로 두고, 실제 누출 사례인 `session_…:uuid` 형태를 더해 매칭한다.
// 숫자 citation([1])과 wikilink([[…]])는 건드리지 않는다.
const BLOCK_REF_SOURCE =
  "(?:[A-Za-z0-9_.-]+:)?(?:B\\d{4}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})";
const BLOCK_REF_TOKEN = new RegExp(`\\s*\\[${BLOCK_REF_SOURCE}(?:\\s*,\\s*${BLOCK_REF_SOURCE})*\\]`, "g");

// 마침표 뒤의 citation 묶음([1], [1, 2], [1][2])은 앞 문장에 붙여 둔 채 그 다음 공백에서 나눈다.
const SENTENCE_END = /(?<!\d)\.((?:[ \t]*\[\d+(?:\s*,\s*\d+)*\])*)[ \t]+(?=\S)(?!\[\d)/g;
// 줄 끝에서 끝나는 문장. 다음 줄이 일반 문단이면 빈 줄로 나눈다.
const LINE_SENTENCE_END = /(?<!\d)\.(?:[ \t]*\[\d+(?:\s*,\s*\d+)*\])*[ \t]*$/;
// 나누면 Markdown 구조가 깨지는 줄: 리스트, 제목, 인용, 표.
const STRUCTURAL_LINE = /^\s*(?:[-*+]\s|\d+[.)]\s|#|>|\|)/;
const CODE_FENCE = /^\s*(?:```|~~~)/;

function isPlainTextLine(line: string | undefined): boolean {
  return line !== undefined && line.trim() !== "" && !STRUCTURAL_LINE.test(line) && !CODE_FENCE.test(line);
}

/**
 * 문장 끝 마침표 뒤에 빈 줄을 넣어 답변 가독성을 높인다.
 * 소수점, 리스트·제목·인용·표 줄, 코드 펜스 안은 나누지 않는다.
 */
export function formatAnswerMarkdown(content: string): string {
  const lines = content.replace(BLOCK_REF_TOKEN, "").split("\n");
  let isInFence = false;

  return lines.map((line, index) => {
    if (CODE_FENCE.test(line)) {
      isInFence = !isInFence;
      return line;
    }
    if (isInFence || !isPlainTextLine(line)) return line;

    const formatted = line.replace(SENTENCE_END, (_, cites: string) => `.${cites}\n\n`);
    return LINE_SENTENCE_END.test(formatted) && isPlainTextLine(lines[index + 1]) ? `${formatted}\n` : formatted;
  }).join("\n");
}

/** citation 근거의 block id와 본문을 합쳐 메타 문자열을 만든다. */
export function formatReferenceMeta(reference: ChatMessageReferenceResponse): string {
  const blockLabel = reference.source_block_ids?.length ? reference.source_block_ids.join(", ") : null;
  const description = reference.text || "";

  return [blockLabel, description].filter(Boolean).join(" · ") || "관련 근거";
}
