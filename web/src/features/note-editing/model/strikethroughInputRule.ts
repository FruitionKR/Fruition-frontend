import type { Ctx } from "@milkdown/ctx";
import { inputRulesCtx } from "@milkdown/core";
import { strikethroughSchema } from "@milkdown/kit/preset/gfm";
import { markRule } from "@milkdown/prose";
import { $inputRule } from "@milkdown/utils";

// Crepe(gfm preset) 기본 취소선 입력 규칙. `~` 하나로도 취소선이 되어 "5~7초" 같은 범위 표기가 깨진다.
const CREPE_STRIKETHROUGH_PATTERN = /(?<![\w:/])(~{1,2})(.+?)\1(?!\w|\/)$/;

/** 취소선은 `~~내용~~`만 인정한다. */
export const DOUBLE_TILDE_STRIKETHROUGH_PATTERN = /(?<![\w:/])~~(.+?)~~(?!\w|\/)$/;

export function configureStrikethrough(ctx: Ctx) {
  // remark-gfm 파서 옵션. 저장 시 직렬화는 항상 `~~`라 불러오기만 맞추면 된다.
  ctx.set("remarkGFM", { singleTilde: false });
}

export const doubleTildeStrikethroughInputRule = $inputRule((ctx) => {
  ctx.update(inputRulesCtx, (rules) =>
    // ProseMirror는 런타임의 match 필드를 타입 선언에서 숨긴다.
    rules.filter((rule) => (rule as unknown as { match: RegExp }).match.source !== CREPE_STRIKETHROUGH_PATTERN.source)
  );
  return markRule(DOUBLE_TILDE_STRIKETHROUGH_PATTERN, strikethroughSchema.type(ctx));
});
