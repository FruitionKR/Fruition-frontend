import type { Ctx } from "@milkdown/ctx";
import type { EditorView } from "@milkdown/prose/view";
import { NodeSelection, TextSelection } from "@milkdown/prose/state";
import koDocuments from "@/shared/i18n/messages/ko/documents.json";

/** 수식 편집 창 문구(documents.editor.math 메시지) */
export type MathEditorLabels = typeof koDocuments.editor.math;

/** 수식 입력에는 중첩 ProseMirror 대신 일반 textarea를 사용한다. */
function createMathEditor(view: EditorView, labels: MathEditorLabels) {
  const root = document.createElement("div");
  root.className = "note-math-editor";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", labels.dialog);
  root.hidden = true;
  const input = document.createElement("textarea");
  input.setAttribute("aria-label", labels.input);
  input.placeholder = labels.placeholder;
  input.rows = 3;
  input.spellcheck = false;
  const hint = document.createElement("p");
  hint.textContent = labels.hint;
  const actions = document.createElement("div");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = labels.cancel;
  const apply = document.createElement("button");
  apply.type = "button";
  apply.textContent = labels.apply;
  actions.append(cancel, apply);
  root.append(input, hint, actions);
  view.dom.parentElement!.append(root);
  let activePos: number | null = null;
  let originalValue = "";
  let destroyed = false;

  function position() {
    if (root.hidden || activePos === null) return;
    const target = view.nodeDOM(activePos);
    if (!(target instanceof Element)) return;
    const rect = target.getBoundingClientRect();
    root.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - root.offsetWidth - 8))}px`;
    const below = rect.bottom + 8;
    root.style.top = `${Math.max(8, below + root.offsetHeight <= window.innerHeight - 8 ? below : rect.top - root.offsetHeight - 8)}px`;
  }

  function finish(save: boolean) {
    if (activePos === null) return;
    const pos = activePos;
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== "math_inline") return;
    const value = save ? input.value : originalValue;
    const tr = view.state.tr;
    const remove = !value.trim();
    if (remove) tr.delete(pos, pos + node.nodeSize);
    else if (save) tr.setNodeAttribute(pos, "value", value);
    tr.setSelection(TextSelection.near(tr.doc.resolve(remove ? pos : pos + node.nodeSize)));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault(); event.stopPropagation(); finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); finish(false);
    }
  });
  apply.addEventListener("click", () => finish(true));
  cancel.addEventListener("click", () => finish(false));
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  window.addEventListener("resize", position);
  document.addEventListener("scroll", position, true);

  function update() {
    const selection = view.state.selection;
    if (!view.editable || !(selection instanceof NodeSelection) || selection.node.type.name !== "math_inline") {
      root.hidden = true; activePos = null; return;
    }
    const value = String(selection.node.attrs.value ?? "");
    const opened = root.hidden || activePos !== selection.from;
    if (opened || originalValue !== value) {
      input.value = value.trim() ? value : "";
      originalValue = value;
    }
    activePos = selection.from;
    root.hidden = false;
    position();
    if (opened) queueMicrotask(() => {
      if (destroyed || root.hidden) return;
      input.focus();
      input.setSelectionRange(0, input.value.length);
    });
  }
  update();
  return {
    update,
    destroy() {
      destroyed = true;
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      root.remove();
    }
  };
}

/** labels를 주지 않으면 한국어 문구를 쓴다(화면 언어를 받지 않는 편집기용). */
export function configureMathEditor(ctx: Ctx, labels: MathEditorLabels = koDocuments.editor.math) {
  ctx.set("INLINE_LATEX_TOOLTIP_SPEC", { view: (view: EditorView) => createMathEditor(view, labels) });
}
