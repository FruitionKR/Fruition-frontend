import type { Ctx } from "@milkdown/ctx";
import { commandsCtx, editorViewCtx, inputRulesCtx, remarkPluginsCtx, schemaCtx } from "@milkdown/core";
import { block } from "@milkdown/kit/plugin/block";
import { NodeSelection, Plugin, TextSelection } from "@milkdown/prose/state";
import { InputRule } from "@milkdown/prose/inputrules";
import { $inputRule, $prose } from "@milkdown/utils";
import { remarkClosedMath } from "../../../shared/lib/remarkClosedMath";

export function configureMarkdownMath(ctx: Ctx) {
  // Crepe의 remarkMath 옵션은 공개 context 이름으로 설정한다.
  // 이 옵션은 불러오기뿐 아니라 inlineMath 저장 구분자에도 적용된다.
  ctx.set("remarkMath", { singleDollarTextMath: false });
  // Crepe가 math를 LaTeX 코드 블록으로 바꾸기 전에 닫는 구분자를 확인한다.
  ctx.update(remarkPluginsCtx, (plugins) => [{ plugin: remarkClosedMath, options: {} }, ...plugins]);
}

export function disableBlockHandle(ctx: Ctx) {
  // 핸들 DOM을 생성하는 view 자체를 교체한다. '/' 메뉴는 별도 플러그인이다.
  ctx.set(block.key, { view: () => ({ update() {}, destroy() {} }) });
}

export function insertMathFromSlash(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  const { $from } = view.state.selection;
  const before = $from.parent.textBetween(0, $from.parentOffset);
  const trigger = before.match(/\/(?:수식|math)?$/i);
  if (trigger) view.dispatch(view.state.tr.delete($from.pos - trigger[0].length, $from.pos));
  // Crepe의 수식 편집 팝업은 빈 문자열을 text node로 만들면 예외가 발생한다.
  // 빈 입력은 편집 가능한 공백으로 시작하고, 선택한 문장이 있으면 그대로 사용한다.
  if (view.state.selection.empty) {
    const from = view.state.selection.from;
    const tr = view.state.tr.insertText(" ", from);
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from, from + 1)));
  }
  // 선택 툴바와 동일한 인라인 수식 명령을 사용한다.
  ctx.get(commandsCtx).call("ToggleLatex");
  view.focus();
}

/** 입력 규칙이 실행되지 않는 붙여넣기와 여러 문단의 닫힌 수식도 변환한다. */
export function createCompletedMathPlugin() {
  return new Plugin({
  appendTransaction(transactions, _oldState, state) {
    if (!transactions.some((tr) => tr.docChanged) || transactions.some((tr) => tr.getMeta("history$"))) return null;
    const replacements: { from: number; to: number; value: string; block: boolean }[] = [];
    state.doc.descendants((parent, parentPos) => {
      if (parent.type.name === "code_block") return false;
      if (parent.isText && !parent.marks.some((mark) => mark.type.name === "inlineCode" || mark.type.name === "code")) {
        for (const match of (parent.text ?? "").matchAll(/(?<![\\$])\$\$([^$]*)\$\$(?!\$)/g)) {
          // 빈 구분자는 현재 입력 위치에서만 새 수식으로 만든다.
          if (!match[1].trim() && (!state.selection.empty || parentPos + match.index! + match[0].length !== state.selection.from)) continue;
          replacements.push({ from: parentPos + match.index!, to: parentPos + match.index! + match[0].length, value: match[1], block: false });
        }
      }
    });
    // 공백·빈 줄을 포함해 같은 부모 아래의 문단으로 입력된 display math.
    const collectBlocks = (parent: typeof state.doc, contentStart: number) => {
      let opening: number | null = null;
      let lines: string[] = [];
      parent.forEach((node, offset) => {
        const pos = contentStart + offset;
        if (node.type.name !== "paragraph" || node.childCount > 0 && !node.content.content.every((child) => (child.isText || child.type.name === "hardbreak") && !child.marks.some((mark) => mark.type.name === "inlineCode" || mark.type.name === "code"))) {
          opening = null; lines = [];
          if (!node.isTextblock) collectBlocks(node, pos + 1);
          return;
        }
        const text = node.textBetween(0, node.content.size, "\n", "\n");
        if (text.trim() === "$$") {
          if (opening !== null) {
            if (lines.join("\n").trim()) replacements.push({ from: opening, to: pos + node.nodeSize, value: lines.join("\n"), block: true });
            opening = null; lines = [];
          } else opening = pos;
        } else if (opening !== null) lines.push(text);
      });
    };
    collectBlocks(state.doc, 0);
    if (!replacements.length) return null;
    const tr = state.tr;
    // 문단 수식 안의 인라인 후보는 문단 수식 변환에 포함된다.
    const blocks = replacements.filter((item) => item.block);
    const changes = replacements.filter((item) => item.block || !blocks.some((range) => item.from >= range.from && item.to <= range.to));
    const emptyMath = changes.find((item) => !item.block && !item.value.trim());
    for (const item of changes.sort((a, b) => b.from - a.from)) {
      const node = item.block
        ? state.schema.nodes.code_block.create({ language: "LaTeX" }, state.schema.text(item.value))
        : state.schema.nodes.math_inline.create({ value: item.value });
      tr.replaceWith(item.from, item.to, node);
    }
    if (emptyMath) tr.setSelection(NodeSelection.create(tr.doc, tr.mapping.map(emptyMath.from, -1)));
    return tr;
  }
});
}

export const completedMathPlugin = $prose(createCompletedMathPlugin);

// Crepe의 Latex 기능을 등록한 뒤 사용해야 기본 입력 규칙을 교체할 수 있다.
export const doubleDollarMathInputRule = $inputRule((ctx) => {
  const crepeInlinePattern = /(?:\$)([^$]+)(?:\$)$/;
  const crepeBlockPattern = /^\$\$[\s\n]$/;
  ctx.update(inputRulesCtx, (rules) =>
    // ProseMirror는 런타임의 match 필드를 타입 선언에서 숨긴다.
    rules.filter((rule) =>
      ![crepeInlinePattern.source, crepeBlockPattern.source].includes(
        (rule as unknown as { match: RegExp }).match.source
      )
    )
  );
  return new InputRule(/(?<![\\$])\$\$([^$]*)\$\$$/, (state, match, start, end) => {
    const value = match[1] ?? "";
    const tr = state.tr.replaceWith(start, end, ctx.get(schemaCtx).nodes.math_inline.create({ value }));
    // 빈 수식은 생성 직후 선택해 수식 입력창으로 포커스를 넘긴다.
    if (!value.trim()) tr.setSelection(NodeSelection.create(tr.doc, start));
    return tr;
  });
});
