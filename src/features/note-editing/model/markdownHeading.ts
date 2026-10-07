import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx, inputRulesCtx } from "@milkdown/core";
import { headingKeymap, headingSchema } from "@milkdown/kit/preset/commonmark";
import { textblockTypeInputRule } from "@milkdown/prose/inputrules";
import { $inputRule } from "@milkdown/utils";

// 본문(14px)과 같거나 작은 h4(14px)·h5(12px)·h6(11px)은 편집기에서 새로 만들지 않는다.
// 이미 저장된 h4~h6은 스키마가 그대로 읽고 렌더한다.
export const MAX_EDITOR_HEADING_LEVEL = 3;

// commonmark preset 기본 제목 입력 규칙(/^(?<hashes>#+)\s$/)의 source. 이 규칙을 걸러내고 바꿔 끼운다.
const COMMONMARK_HEADING_PATTERN_SOURCE = "^(?<hashes>#+)\\s$";

export const HEADING_INPUT_PATTERN = /^(#+)\s$/;

/** `#` 개수(제목 안에서 입력하면 현재 단계에 더한다)로 만들 제목 단계를 정하고, h3를 넘지 않게 한다. */
export function resolveHeadingInputLevel(hashCount: number, currentHeadingLevel: number | null): number {
  return Math.min((currentHeadingLevel ?? 0) + hashCount, MAX_EDITOR_HEADING_LEVEL);
}

export const cappedHeadingInputRule = $inputRule((ctx) => {
  ctx.update(inputRulesCtx, (rules) =>
    // ProseMirror는 런타임의 match 필드를 타입 선언에서 숨긴다.
    rules.filter((rule) => (rule as unknown as { match: RegExp }).match.source !== COMMONMARK_HEADING_PATTERN_SOURCE)
  );
  return textblockTypeInputRule(HEADING_INPUT_PATTERN, headingSchema.type(ctx), (match) => {
    const node = ctx.get(editorViewCtx).state.selection.$from.node();
    const currentLevel = node.type.name === "heading" ? Number(node.attrs.level) : null;
    return { level: resolveHeadingInputLevel(match[1].length, currentLevel) };
  });
});

/** Mod-Alt-4/5/6 제목 단축키를 끈다. */
export function disableSmallHeadingShortcuts(ctx: Ctx) {
  ctx.update(headingKeymap.key, (keymap) => ({
    ...keymap,
    TurnIntoH4: { ...keymap.TurnIntoH4, shortcuts: [] },
    TurnIntoH5: { ...keymap.TurnIntoH5, shortcuts: [] },
    TurnIntoH6: { ...keymap.TurnIntoH6, shortcuts: [] }
  }));
}
