import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { Schema } from "@milkdown/prose/model";
import { EditorState, TextSelection } from "@milkdown/prose/state";
registerHooks({ resolve(s, c, next) { return next(s.endsWith('/remarkClosedMath') ? s + '.ts' : s, c); } });
const { createCompletedMathPlugin } = await import('../src/features/note-editing/model/markdownMath.ts');
const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' },
  text: { group: 'inline' }, hardbreak: { group: 'inline', inline: true },
  math_inline: { group: 'inline', inline: true, atom: true, attrs: { value: { default: '' } } },
  code_block: { group: 'block', content: 'text*', marks: '', code: true, attrs: { language: { default: '' } } }
}, marks: { inlineCode: { code: true } } });
const paragraph = text => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
function editor(doc = schema.nodes.doc.create(null, paragraph(''))) {
  let state = EditorState.create({ schema, doc, plugins: [createCompletedMathPlugin()] });
  return { get state() { return state; }, apply(tr) { state = state.applyTransaction(tr).state; } };
}

test('붙여넣기에서도 닫힌 수식만 인라인 수식으로 전환한다', () => {
  for (const text of ['$$', '$$ ', '$$x+y', '$x+y$', '\\$$x+y$$']) {
    const e = editor(); e.apply(e.state.tr.insertText(text));
    assert.equal(e.state.doc.firstChild.textContent, text);
  }
  const e = editor(); e.apply(e.state.tr.insertText('앞 $$x+y$$ 뒤 $$z=2$$'));
  const nodes = e.state.doc.firstChild.content.content;
  assert.deepEqual(nodes.filter(n => n.type.name === 'math_inline').map(n => n.attrs.value), ['x+y', 'z=2']);
  assert.equal(e.state.doc.textContent, '앞  뒤 ');
});

test('Enter로 여러 문단을 입력한 뒤 닫는 $$를 완성하면 수식으로 전환한다', () => {
  const e = editor();
  for (const char of '$$\nx+y\nz=2\n$$') {
    if (char === '\n') e.apply(e.state.tr.split(e.state.selection.from));
    else e.apply(e.state.tr.insertText(char));
  }
  assert.equal(e.state.doc.childCount, 1);
  assert.equal(e.state.doc.firstChild.type.name, 'code_block');
  assert.equal(e.state.doc.firstChild.attrs.language, 'LaTeX');
  assert.equal(e.state.doc.firstChild.textContent, 'x+y\nz=2');
});

test('닫힌 여러 줄 수식 변환은 앞뒤 문장을 보존한다', () => {
  const e = editor(schema.nodes.doc.create(null, ['앞', '$$', 'x+y', '$', '뒤'].map(paragraph)));
  const pos = e.state.doc.child(0).nodeSize + e.state.doc.child(1).nodeSize + e.state.doc.child(2).nodeSize + 2;
  e.apply(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos)).insertText('$'));
  assert.equal(e.state.doc.childCount, 3);
  assert.equal(e.state.doc.firstChild.textContent, '앞');
  assert.equal(e.state.doc.lastChild.textContent, '뒤');
});

test('코드로 표시된 달러 구분자는 변환하지 않는다', () => {
  const e = editor(schema.nodes.doc.create(null, schema.nodes.code_block.create(null, schema.text('코드 '))));
  e.apply(e.state.tr.insertText('$$x+y$$', 1));
  assert.equal(e.state.doc.firstChild.type.name, 'code_block');
  assert.match(e.state.doc.firstChild.textContent, /\$\$x\+y\$\$/);
  const code = schema.marks.inlineCode.create();
  const marked = editor(schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text('code', [code]))));
  marked.apply(marked.state.tr.insertText('$$x+y$$', 2));
  assert.equal(marked.state.doc.firstChild.childCount, 1);
  assert.equal(marked.state.doc.firstChild.firstChild.isText, true);
});

test('빈 $$$$를 입력하면 수식을 선택해 입력창을 바로 열 수 있다', () => {
  const e = editor();
  for (const char of '$$$$') e.apply(e.state.tr.insertText(char));
  assert.equal(e.state.doc.firstChild.firstChild.type.name, 'math_inline');
  assert.equal(e.state.selection.node.type.name, 'math_inline');
  assert.equal(e.state.selection.node.attrs.value, '');
});

test('문장 중간에 붙여넣은 빈 수식도 올바른 위치에서 선택한다', () => {
  const e = editor(schema.nodes.doc.create(null, paragraph('앞 뒤')));
  e.apply(e.state.tr.setSelection(TextSelection.create(e.state.doc, 3)).insertText('$$$$'));
  assert.equal(e.state.doc.textContent, '앞 뒤');
  assert.equal(e.state.selection.from, 3);
  assert.equal(e.state.selection.node.type.name, 'math_inline');
});
