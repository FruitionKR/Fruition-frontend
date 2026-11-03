/**
 * 코드 블록(``` / ~~~)과 인라인 코드(`…`) 밖의 Markdown 텍스트에만 변환을 적용한다.
 * 테스트가 그대로 불러 쓰도록 다른 모듈을 import하지 않는다.
 */

const INLINE_CODE = /`[^`\n]+`/g;
const MASK = /\u0000C(\d+)\u0000/g;

function mapOutsideInlineCode(text: string, transform: (text: string) => string): string {
  const codes: string[] = [];
  const masked = text.replace(INLINE_CODE, (code) => `\u0000C${codes.push(code) - 1}\u0000`);
  return transform(masked).replace(MASK, (_whole, index: string) => codes[Number(index)] ?? "");
}

/** 원문에 섞인 NUL은 지운다. 이 모듈과 자리표시 토큰이 NUL을 구분자로 쓴다. */
export function stripNul(text: string): string {
  return text.replace(/\u0000/g, "");
}

export function mapOutsideCode(markdown: string, transform: (text: string) => string): string {
  const output: string[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (buffer.length > 0) output.push(mapOutsideInlineCode(buffer.join("\n"), transform));
    buffer = [];
  };
  for (const line of markdown.split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null && marker) {
      flush();
      fence = marker;
      output.push(line);
    } else if (fence !== null) {
      output.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
    } else buffer.push(line);
  }
  flush();
  return output.join("\n");
}
