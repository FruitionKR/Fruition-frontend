/**
 * Notion Markdown 안의 원시 HTML(콜아웃 <aside>, 토글 <details> 등)을 안전한 Markdown 텍스트로 바꾼다.
 * 앱의 Markdown 표시(react-markdown)·편집기는 원시 HTML을 그리지 않으므로, 태그는 모두 없애고 내용만 남긴다.
 * 콜아웃·토글은 인용문으로, <script>·<style> 등은 내용째 지운다. 태그를 지우면 on* 속성도 함께 사라진다.
 * 코드 블록·인라인 코드 안은 건드리지 않는다.
 */
import { mapOutsideCode, stripNul } from "@/shared/lib/markdown-import/markdownText";

const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DANGLING_DROP = /<(script|style|iframe|object|embed|template|noscript)\b[^>]*\/?>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
const BLOCKQUOTE_BLOCK = /<(aside|details|blockquote)\b[^>]*>((?:(?!<(?:aside|details|blockquote)\b)[\s\S])*?)<\/\1\s*>/i;
const SUMMARY = /<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
const BLOCK_END = /<\/(p|div|li|h[1-6]|tr)\s*>/gi;
const ANY_TAG = /<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s[^<>]*)?\/?>/g;

function stripTags(html: string): string {
  return html.replace(LINE_BREAK, "\n").replace(BLOCK_END, "\n").replace(ANY_TAG, "");
}

function toBlockquote(inner: string): string {
  const text = stripTags(inner.replace(SUMMARY, (_whole, summary: string) => `**${stripTags(summary).trim()}**\n`));
  const lines = text.split("\n").map((line) => line.trim().replace(/^>\s?/, ""));
  const compact = lines.filter((line, index) => line !== "" || (index > 0 && lines[index - 1] !== ""));
  while (compact.length > 0 && compact[0] === "") compact.shift();
  while (compact.length > 0 && compact[compact.length - 1] === "") compact.pop();
  if (compact.length === 0) return "";
  return `\n${compact.map((line) => (line ? `> ${line}` : ">")).join("\n")}\n`;
}

function sanitizeSegment(segment: string): string {
  let text = segment.replace(COMMENT, "").replace(DROP_WITH_CONTENT, "").replace(DANGLING_DROP, "");
  // 안쪽(다른 콜아웃·토글을 품지 않은) 블록부터 하나씩 인용문으로 푼다. 짝 없는 태그는 아래에서 지운다.
  for (let guard = 0; guard < 1000; guard += 1) {
    const next = text.replace(BLOCKQUOTE_BLOCK, (_whole, _tag: string, inner: string) => toBlockquote(inner));
    if (next === text) break;
    text = next;
  }
  return stripTags(text);
}

/** HTML을 지운 Markdown. 코드 블록·인라인 코드 안은 그대로 둔다. */
export function sanitizeNotionMarkdown(markdown: string): string {
  return mapOutsideCode(stripNul(markdown), (text) => sanitizeSegment(text).replace(/\n{3,}/g, "\n\n"));
}
