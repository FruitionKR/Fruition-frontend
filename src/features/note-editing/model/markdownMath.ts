import type { Ctx } from "@milkdown/ctx";
import { inputRulesCtx, schemaCtx } from "@milkdown/core";
import { nodeRule } from "@milkdown/prose";
import { $inputRule } from "@milkdown/utils";

export function configureMarkdownMath(ctx: Ctx) {
  // Crepe의 remarkMath 옵션은 공개 context 이름으로 설정한다.
  // 이 옵션은 불러오기뿐 아니라 inlineMath 저장 구분자에도 적용된다.
  ctx.set("remarkMath", { singleDollarTextMath: false });
}

// Crepe의 Latex 기능을 등록한 뒤 사용해야 기본 입력 규칙을 교체할 수 있다.
export const doubleDollarMathInputRule = $inputRule((ctx) => {
  const crepeInlinePattern = /(?:\$)([^$]+)(?:\$)$/;
  ctx.update(inputRulesCtx, (rules) =>
    // ProseMirror는 런타임의 match 필드를 타입 선언에서 숨긴다.
    rules.filter((rule) =>
      (rule as unknown as { match: RegExp }).match.source !== crepeInlinePattern.source
    )
  );
  return nodeRule(/(?<![\\$])\$\$([^$]+)\$\$$/, ctx.get(schemaCtx).nodes.math_inline, {
    getAttr: (match) => ({ value: match[1] ?? "" }),
  });
});
