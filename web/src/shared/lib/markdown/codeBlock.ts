/**
 * 문서 보기 코드 블록(MarkdownViewer)의 순수 로직.
 * 편집기(Milkdown Crepe)와 같은 규칙으로 언어 이름·복사 텍스트·줄 수를 정한다.
 */

/** 언어가 없을 때 편집기 언어 버튼이 보여 주는 이름과 같다. */
export const PLAIN_CODE_LANGUAGE = "Text";

const LANGUAGE_CLASS_PREFIX = "language-";

/**
 * `<code class="language-js">`의 className에서 언어 이름을 꺼낸다.
 * 편집기처럼 펜스에 쓴 이름을 그대로 보여 주고, 없으면 "Text"를 돌려준다.
 */
export function codeBlockLanguage(className: unknown): string {
  const classes = Array.isArray(className)
    ? className.map(String)
    : typeof className === "string"
      ? className.split(/\s+/)
      : [];
  const language = classes
    .find((name) => name.startsWith(LANGUAGE_CLASS_PREFIX))
    ?.slice(LANGUAGE_CLASS_PREFIX.length)
    .trim();
  return language || PLAIN_CODE_LANGUAGE;
}

type HastLike = { type?: string; value?: unknown; children?: readonly HastLike[] };

/** hast 노드 아래 글자를 이어 붙인다. */
export function hastText(node: HastLike | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return typeof node.value === "string" ? node.value : "";
  return (node.children ?? []).map(hastText).join("");
}

/**
 * 클립보드에 넣을 코드 텍스트. markdown→hast 변환이 코드 끝에 붙이는 줄바꿈 하나만 떼고
 * 나머지 공백·빈 줄은 그대로 둔다. 줄 번호는 별도 요소라 여기에 들어오지 않는다.
 */
export function codeBlockCopyText(rawText: string): string {
  return rawText.endsWith("\n") ? rawText.slice(0, -1) : rawText;
}

/** 줄 번호 개수. 빈 코드 블록도 편집기처럼 1번 줄을 보여 준다. */
export function codeBlockLineCount(copyText: string): number {
  return copyText.split("\n").length;
}
