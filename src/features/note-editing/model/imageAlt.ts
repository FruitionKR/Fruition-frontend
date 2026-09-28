import type { Ctx } from "@milkdown/ctx";
import { imageBlockSchema } from "@milkdown/kit/component/image-block";

import { formatImageAlt, splitImageAlt } from "./imageAltText";

// Crepe image-block은 Markdown alt 칸에 크기 비율("1.00")을 쓰고 읽는다.
// 그대로 두면 백엔드 변환 문서의 `![diagram](…)` 같은 실제 alt가 열기만 해도 "1.00"으로 바뀐다.
// 판정 규칙은 imageAltText.ts 참고.
type ImageBlockAttrs = { src: string; caption: string; ratio: number; alt: string };

/** image-block 스키마를 확장해 숫자가 아닌 alt는 보존하고, 비율은 alt가 비어 있을 때만 기록한다. */
export function preserveImageAlt(ctx: Ctx) {
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
        runner: (state, node, type) => {
          const { alt, ratio } = splitImageAlt(node.alt as string | null | undefined);
          state.addNode(type, { src: node.url, caption: node.title, ratio, alt });
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
