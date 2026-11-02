import type { Ctx } from "@milkdown/ctx";
import { imageBlockSchema } from "@milkdown/kit/component/image-block";
import { imageSchema } from "@milkdown/kit/preset/commonmark";

import { formatImageAlt, imageBlockAttrsFromMarkdown, inlineImageAttrsFromMarkdown } from "./imageAltText";

// Crepe image-block은 Markdown alt 칸에 크기 비율("1.00")을 쓰고 읽는다.
// 그대로 두면 백엔드 변환 문서의 `![diagram](…)` 같은 실제 alt가 열기만 해도 "1.00"으로 바뀐다.
// 판정 규칙은 imageAltText.ts 참고.
type ImageBlockAttrs = { src: string; caption: string; ratio: number; alt: string };

/** 인라인 image 스키마도 제목·alt가 null이면 빈 문자열로 읽는다(Milkdown 기본 runner는 null을 그대로 넘긴다). */
function nullSafeInlineImage(ctx: Ctx) {
  ctx.update(imageSchema.ctx.key, (prev) => (schemaCtx) => {
    const base = prev(schemaCtx);
    return {
      ...base,
      parseMarkdown: {
        match: base.parseMarkdown.match,
        runner: (state, node, type) => {
          state.addNode(type, inlineImageAttrsFromMarkdown(node));
        }
      }
    };
  });
}

/** image-block 스키마를 확장해 숫자가 아닌 alt는 보존하고, 비율은 alt가 비어 있을 때만 기록한다. */
export function preserveImageAlt(ctx: Ctx) {
  nullSafeInlineImage(ctx);
  ctx.update(imageBlockSchema.ctx.key, (prev) => (schemaCtx) => {
    const base = prev(schemaCtx);
    const [baseRule] = base.parseDOM ?? [];
    return {
      ...base,
      attrs: { ...base.attrs, alt: { default: "", validate: "string" } },
      parseDOM: [{
        ...baseRule,
        getAttrs: (dom) => ({
          ...(baseRule?.getAttrs?.(dom) as Record<string, unknown> | null),
          alt: dom instanceof HTMLElement ? dom.getAttribute("alt") ?? "" : ""
        })
      }],
      parseMarkdown: {
        match: ({ type }) => type === "image-block",
        // 제목 없는 `![alt](src)`는 title이 null이라 그대로 넘기면 caption 검증(string)에서 RangeError가 난다.
        runner: (state, node, type) => {
          state.addNode(type, imageBlockAttrsFromMarkdown(node));
        }
      },
      toMarkdown: {
        match: (node) => node.type.name === "image-block",
        runner: (state, node) => {
          const attrs = node.attrs as ImageBlockAttrs;
          state.openNode("paragraph");
          state.addNode("image", undefined, undefined, {
            title: attrs.caption,
            url: attrs.src,
            alt: formatImageAlt(attrs.alt, attrs.ratio)
          });
          state.closeNode();
        }
      }
    };
  });
}
