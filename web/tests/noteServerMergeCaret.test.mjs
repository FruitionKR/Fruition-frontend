import assert from "node:assert/strict";
import test from "node:test";

const { Schema } = await import("@milkdown/prose/model");
const { EditorState, TextSelection } = await import("@milkdown/prose/state");
const { buildServerMergeTransaction, rebaseLocalEdits, resolveEditorBodyUpdate } = await import("../src/features/note-editing/model/serverMergeTransaction.ts");

// Milkdown commonmark·gfm과 같은 이름·내용 규칙을 갖춘 최소 schema. heading id는 실제 편집기처럼 parser에서 비어 있다.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { id: { default: "" }, level: { default: 1 } } },
    blockquote: { group: "block", content: "block+" },
    code_block: { group: "block", content: "text*", marks: "" },
    hr: { group: "block" },
    bullet_list: { group: "block", content: "list_item+" },
    list_item: { content: "paragraph block*", attrs: { label: { default: "•" } } },
    table: { group: "block", content: "table_header_row table_row+" },
    table_header_row: { content: "table_header*" },
    table_row: { content: "table_cell*" },
    table_header: { content: "paragraph+" },
    table_cell: { content: "paragraph+" },
    text: { group: "inline" }
  },
  marks: { strong: {} }
});

const inline = (value) => (value ? [schema.text(value)] : []);
const p = (value = "") => schema.node("paragraph", null, inline(value));
const h = (value, id = "") => schema.node("heading", { id, level: 1 }, inline(value));
const li = (...content) => schema.node("list_item", null, content.map((c) => (typeof c === "string" ? p(c) : c)));
const ul = (...items) => schema.node("bullet_list", null, items);
const quote = (...content) => schema.node("blockquote", null, content);
const table = (rows) => schema.node("table", null, rows.map((row, i) => schema.node(i === 0 ? "table_header_row" : "table_row", null,
  row.map((cell) => schema.node(i === 0 ? "table_header" : "table_cell", null, [p(cell)])))));
const docOf = (...blocks) => schema.node("doc", null, blocks);

/** text가 들어 있는 첫 textblock에서 offset 자리의 문서 위치를 돌려준다. */
function posIn(doc, text, offset = text.length, nth = 0) {
  let found = null;
  let seen = 0;
  doc.descendants((node, pos) => {
    if (found !== null || !node.isTextblock) return found === null;
    if (node.textContent === text) {
      if (seen === nth) found = pos + 1 + offset;
      seen += 1;
    }
    return false;
  });
  assert.notEqual(found, null, `line not found: ${text}`);
  return found;
}

function merged(doc, nextDoc, anchor, head = anchor) {
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, anchor, head) });
  const tr = buildServerMergeTransaction(state, nextDoc);
  return { tr, state: state.apply(tr) };
}

/** 캐럿이 있는 줄의 글자와 그 줄 안 위치. */
function caret(state) {
  const { $head } = state.selection;
  return { line: $head.parent.textContent, offset: $head.parentOffset };
}

function plain(node) {
  return JSON.stringify(node.toJSON(), (key, value) => (key === "id" ? undefined : value));
}

const assertBodyIs = (state, nextDoc) => assert.equal(plain(state.doc), plain(nextDoc));

const TITLE = "캐럿 시험";
const SYNCED = h(TITLE, "캐럿-시험");
const ABOVE = "이번 달 매출은 5억 원이다.";
const ABOVE2 = "이번 달 영업이익은 5억 원이다.";
const MEMO = "이 칸은 사람이 적는 메모다.가나";
const BELOW = "다음 달 매출 목표는 추후 정한다.";
const BELOW2 = "다음 달 영업이익 목표는 추후 정한다.";

test("제목 id만 다르고 아래 줄이 바뀌면 캐럿은 입력하던 줄 끝에 남는다", () => {
  const doc = docOf(SYNCED, p(ABOVE), p(MEMO), p(BELOW));
  const next = docOf(h(TITLE), p(ABOVE), p(MEMO), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, MEMO));
  assert.deepEqual(caret(state), { line: MEMO, offset: MEMO.length });
  assertBodyIs(state, next);
});

test("제목이 있는 문서에서 위아래가 모두 바뀌어도 캐럿은 입력하던 줄 끝에 남는다", () => {
  const doc = docOf(SYNCED, p(ABOVE), p(MEMO), p(BELOW));
  const next = docOf(h(TITLE), p(ABOVE2), p(MEMO), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, MEMO));
  assert.deepEqual(caret(state), { line: MEMO, offset: MEMO.length });
  assertBodyIs(state, next);
});

test("제목이 없어도 위아래가 모두 바뀌면 캐럿은 입력하던 줄에 남는다", () => {
  const doc = docOf(p(ABOVE), p(MEMO), p(BELOW));
  const next = docOf(p(ABOVE2), p(MEMO), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, MEMO, 3));
  assert.deepEqual(caret(state), { line: MEMO, offset: 3 });
  assertBodyIs(state, next);
});

test("위만 바뀌면 글자 수만큼 위치가 밀려도 캐럿은 같은 자리다", () => {
  const doc = docOf(SYNCED, p(ABOVE), p(MEMO), p(BELOW));
  const next = docOf(h(TITLE), p(ABOVE2), p(MEMO), p(BELOW));
  const { state } = merged(doc, next, posIn(doc, MEMO));
  assert.deepEqual(caret(state), { line: MEMO, offset: MEMO.length });
  assertBodyIs(state, next);
});

test("제목 id만 다르면 문서를 건드리지 않는다", () => {
  const doc = docOf(SYNCED, p(MEMO));
  const { tr } = merged(doc, docOf(h(TITLE), p(MEMO)), posIn(doc, MEMO));
  assert.equal(tr.docChanged, false);
});

for (const [name, next] of [
  ["위에 줄 삽입", docOf(p("새 줄"), p(ABOVE), p(MEMO), p(BELOW))],
  ["바로 위에 줄 여러 개 삽입", docOf(p(ABOVE), p("새 줄 1"), p("새 줄 2"), p(MEMO), p(BELOW))],
  ["바로 아래에 줄 삽입", docOf(p(ABOVE), p(MEMO), p("새 줄"), p(BELOW))],
  ["위아래에 줄 삽입", docOf(p("새 줄 1"), p(ABOVE), p(MEMO), p(BELOW), p("새 줄 2"))],
  ["위 줄 삭제", docOf(p(MEMO), p(BELOW))],
  ["아래 줄 삭제", docOf(p(ABOVE), p(MEMO))],
  ["위아래 줄 삭제", docOf(p(MEMO))],
  ["위 줄 교체와 아래 줄 삽입", docOf(p(ABOVE2), p(MEMO), p(BELOW2), p("새 줄"))]
]) {
  test(`${name}에도 캐럿은 같은 줄 같은 자리다`, () => {
    const doc = docOf(p(ABOVE), p(MEMO), p(BELOW));
    const { state } = merged(doc, next, posIn(doc, MEMO, 4));
    assert.deepEqual(caret(state), { line: MEMO, offset: 4 });
    assertBodyIs(state, next);
  });
}

test("캐럿이 있던 줄이 지워지면 문서 안 가까운 글자 자리로 간다", () => {
  const doc = docOf(p(ABOVE), p(MEMO), p(BELOW));
  const next = docOf(p(ABOVE2), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, MEMO, 4));
  assert.equal(state.selection.$head.parent.isTextblock, true);
  assertBodyIs(state, next);
});

test("같은 글자의 줄이 반복돼도 있던 쪽 줄에 남는다", () => {
  const doc = docOf(p(ABOVE), p("같은 줄"), p("가운데"), p("같은 줄"), p(BELOW));
  const next = docOf(p(ABOVE2), p("같은 줄"), p("가운데 수정"), p("같은 줄"), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, "같은 줄", 2, 1));
  assert.deepEqual(caret(state), { line: "같은 줄", offset: 2 });
  assert.equal(state.selection.$head.index(0), 3);
  assertBodyIs(state, next);
});

test("여러 줄에 걸친 선택 범위는 위아래가 바뀌어도 그대로다", () => {
  const doc = docOf(p(ABOVE), p("선택 시작"), p("선택 끝"), p(BELOW));
  const next = docOf(p(ABOVE2), p("선택 시작"), p("선택 끝"), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, "선택 시작", 3), posIn(doc, "선택 끝", 2));
  assert.equal(state.doc.textBetween(state.selection.from, state.selection.to, "\n"), "시작\n선택");
  assertBodyIs(state, next);
});

test("한 줄 안 선택 범위는 위아래가 바뀌어도 그대로다", () => {
  const doc = docOf(SYNCED, p(ABOVE), p(MEMO), p(BELOW));
  const next = docOf(h(TITLE), p(ABOVE2), p(MEMO), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, MEMO, 2), posIn(doc, MEMO, 6));
  assert.equal(state.doc.textBetween(state.selection.from, state.selection.to), MEMO.slice(2, 6));
  assertBodyIs(state, next);
});

test("선택 범위 사이의 줄이 바뀌어도 양 끝은 있던 줄에 남는다", () => {
  const doc = docOf(p("시작 줄"), p("가운데"), p("끝 줄"));
  const next = docOf(p("시작 줄"), p("가운데 수정"), p("끝 줄"));
  const { state } = merged(doc, next, posIn(doc, "시작 줄", 1), posIn(doc, "끝 줄", 1));
  assert.equal(state.selection.$from.parent.textContent, "시작 줄");
  assert.equal(state.selection.$from.parentOffset, 1);
  assert.equal(state.selection.$to.parent.textContent, "끝 줄");
  assert.equal(state.selection.$to.parentOffset, 1);
  assertBodyIs(state, next);
});

test("문서 끝 줄에 있으면 위가 바뀌고 줄이 늘어도 그 줄 끝에 남는다", () => {
  const doc = docOf(SYNCED, p(ABOVE), p(MEMO));
  const next = docOf(h("제목 수정"), p("새 줄"), p(ABOVE2), p(MEMO));
  const { state } = merged(doc, next, posIn(doc, MEMO));
  assert.deepEqual(caret(state), { line: MEMO, offset: MEMO.length });
  assertBodyIs(state, next);
});

test("문서 끝 줄에 있으면 뒤에 줄이 붙어도 그 줄 끝에 남는다", () => {
  const doc = docOf(p(ABOVE), p(MEMO));
  const next = docOf(p(ABOVE2), p(MEMO), p("덧붙인 줄"), p());
  const { state } = merged(doc, next, posIn(doc, MEMO));
  assert.deepEqual(caret(state), { line: MEMO, offset: MEMO.length });
  assertBodyIs(state, next);
});

test("문서 끝 빈 줄의 캐럿은 위가 바뀌어도 빈 줄에 남는다", () => {
  const doc = docOf(p(ABOVE), p(BELOW), p());
  const next = docOf(p(ABOVE2), p(BELOW2), p());
  const { state } = merged(doc, next, doc.content.size - 1);
  assert.deepEqual(caret(state), { line: "", offset: 0 });
  assert.equal(state.selection.$head.index(0), 2);
  assertBodyIs(state, next);
});

test("같은 줄에서 캐럿 앞이 바뀌면 글자 수만큼 함께 밀린다", () => {
  const before = "이번 달 매출 메모";
  const after = "이번 달 영업이익 메모";
  const doc = docOf(p(before));
  const { state } = merged(doc, docOf(p(after)), posIn(doc, before));
  assert.deepEqual(caret(state), { line: after, offset: after.length });
});

test("같은 줄에서 캐럿 뒤가 바뀌면 캐럿은 그대로다", () => {
  const before = "메모 다음 달 매출";
  const after = "메모 다음 달 영업이익";
  const doc = docOf(p(before));
  const { state } = merged(doc, docOf(p(after)), posIn(doc, before, 2));
  assert.deepEqual(caret(state), { line: after, offset: 2 });
});

test("같은 줄에서 캐럿 앞뒤가 함께 바뀌면 그 줄의 같은 칸에 남는다", () => {
  const before = "가 매출 | 나 매출";
  const after = "가 이익 | 나 이익";
  const doc = docOf(p(before));
  const { state } = merged(doc, docOf(p(after)), posIn(doc, before, 6));
  assert.deepEqual(caret(state), { line: after, offset: 6 });
  assertBodyIs(state, docOf(p(after)));
});

test("캐럿 자리에 글자가 끼어들면 캐럿은 끼어든 글자 앞에 남는다", () => {
  const before = "메모다.";
  const after = "메모다. 덧붙임";
  const doc = docOf(p(before));
  const { state } = merged(doc, docOf(p(after)), posIn(doc, before));
  assert.deepEqual(caret(state), { line: after, offset: before.length });
});

test("캐럿 줄이 짧아지면 그 줄 끝으로 당겨지고 다음 줄로 넘어가지 않는다", () => {
  const doc = docOf(p("아주 긴 줄의 끝"), p(BELOW));
  const next = docOf(p("짧은"), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, "아주 긴 줄의 끝"));
  assert.equal(caret(state).line, "짧은");
  assertBodyIs(state, next);
});

test("위아래와 캐럿 줄이 모두 바뀌면 캐럿은 가장 닮은 줄에 남는다", () => {
  const doc = docOf(p(ABOVE), p("메모 앞부분 메모 뒷부분"), p(BELOW));
  const next = docOf(p(ABOVE2), p("새로 들어온 줄"), p("메모 앞부분 수정 메모 뒷부분"), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, "메모 앞부분 메모 뒷부분", 2));
  assert.deepEqual(caret(state), { line: "메모 앞부분 수정 메모 뒷부분", offset: 2 });
  assertBodyIs(state, next);
});

test("제목 안 캐럿은 제목 글자가 바뀌어도 제목에 남는다", () => {
  const doc = docOf(SYNCED, p(BELOW));
  const next = docOf(h("캐럿 시험 수정"), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, TITLE, 2));
  assert.deepEqual(caret(state), { line: "캐럿 시험 수정", offset: 2 });
  assertBodyIs(state, next);
});

test("목록 항목 안 캐럿은 다른 항목이 바뀌어도 같은 항목에 남는다", () => {
  const doc = docOf(ul(li("첫 항목"), li("적는 항목"), li("끝 항목")));
  const next = docOf(ul(li("첫 항목 수정"), li("새 항목"), li("적는 항목"), li("끝 항목 수정")));
  const { state } = merged(doc, next, posIn(doc, "적는 항목", 2));
  assert.deepEqual(caret(state), { line: "적는 항목", offset: 2 });
  assertBodyIs(state, next);
});

test("인용 안 캐럿은 인용 밖과 인용 안 다른 줄이 바뀌어도 남는다", () => {
  const doc = docOf(p(ABOVE), quote(p("인용 위"), p("인용 메모"), p("인용 아래")), p(BELOW));
  const next = docOf(p(ABOVE2), quote(p("인용 위 수정"), p("인용 메모"), p("인용 아래 수정")), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, "인용 메모"));
  assert.deepEqual(caret(state), { line: "인용 메모", offset: 5 });
  assertBodyIs(state, next);
});

test("표 칸 안 캐럿은 다른 칸과 표 밖이 바뀌어도 같은 칸에 남는다", () => {
  const doc = docOf(p(ABOVE), table([["머리"], ["칸 하나"], ["칸 둘"]]), p(BELOW));
  const next = docOf(p(ABOVE2), table([["머리 수정"], ["칸 하나"], ["칸 둘 수정"]]), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, "칸 하나", 1));
  assert.deepEqual(caret(state), { line: "칸 하나", offset: 1 });
  assertBodyIs(state, next);
});

test("IME 조합 중인 줄은 위아래가 바뀌어도 그 줄 노드를 그대로 둔다", () => {
  // 조합 중인 글자는 편집기 문서에 이미 들어 있다. 그 줄을 건드리지 않아야 브라우저 조합이 끊기지 않는다.
  const composing = "이 칸은 사람이 적는 메모다.ㄱ";
  const doc = docOf(SYNCED, p(ABOVE), p(composing), p(BELOW));
  const next = docOf(h(TITLE), p(ABOVE2), p(composing), p(BELOW2));
  const { state } = merged(doc, next, posIn(doc, composing));
  // 노드 객체가 같으면 ProseMirror가 그 줄의 DOM을 다시 그리지 않는다.
  assert.equal(state.doc.child(2), doc.child(2));
  assert.deepEqual(caret(state), { line: composing, offset: composing.length });
  assertBodyIs(state, next);
});

test("여러 종류의 블록이 섞여 바뀌어도 결과 본문은 항상 서버 본문과 같고 그대로인 캐럿 줄을 떠나지 않는다", () => {
  let seed = 20261105;
  const rand = (n) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };
  const makeBlock = (id) => {
    switch (rand(7)) {
      case 0: return h(`제목${id}`, rand(2) ? `제목${id}` : "");
      case 1: return schema.node("code_block", null, inline(`code${id}`));
      case 2: return schema.node("hr");
      case 3: return ul(li(`항목${id}a`), li(`항목${id}b`));
      case 4: return quote(p(`인용${id}`));
      case 5: return table([[`머리${id}`], [`칸${id}`]]);
      default: return p(rand(5) === 0 ? "" : `줄${id}`);
    }
  };
  for (let round = 0; round < 500; round += 1) {
    const blocks = Array.from({ length: 1 + rand(8) }, (_, i) => makeBlock(`${round}-${i}`));
    const caretIndex = rand(blocks.length);
    const keep = p(`캐럿줄${round}`);
    const docBlocks = blocks.toSpliced(caretIndex, 0, keep);
    const nextBlocks = docBlocks.flatMap((block, i) => {
      if (i === caretIndex) return [block];
      const roll = rand(6);
      if (roll === 0) return [];
      if (roll === 1) return [makeBlock(`${round}-n${i}`)];
      if (roll === 2) return [block, makeBlock(`${round}-m${i}`)];
      if (roll === 3) return [makeBlock(`${round}-m${i}`), block];
      return [block];
    });
    const doc = docOf(...docBlocks);
    const next = docOf(...nextBlocks);
    const text = keep.textContent;
    const offset = rand(text.length + 1);
    const { state } = merged(doc, next, posIn(doc, text, offset));
    assertBodyIs(state, next);
    assert.deepEqual(caret(state), { line: text, offset });
  }
});

// 저장을 보낸 뒤 입력 알림이 저장 훅에 닿기 전에 응답이 온 경우. 서버 본문에는 그 입력이 없다.
const TYPED = `${MEMO}x`;

function rebased(sent, current, next, anchor) {
  const target = rebaseLocalEdits(sent, current, next);
  const state = EditorState.create({ doc: current, selection: TextSelection.create(current, anchor) });
  return { target, state: state.apply(buildServerMergeTransaction(state, target)) };
}

test("보낸 뒤 친 글자는 서버 병합 결과에 남고 다른 곳의 변경도 함께 들어온다", () => {
  const sent = docOf(h(TITLE), p(ABOVE), p(MEMO), p(BELOW));
  const current = docOf(SYNCED, p(ABOVE), p(TYPED), p(BELOW));
  const next = docOf(h(TITLE), p(ABOVE2), p(MEMO), p(BELOW2));
  const { state } = rebased(sent, current, next, posIn(current, TYPED));
  assertBodyIs(state, docOf(h(TITLE), p(ABOVE2), p(TYPED), p(BELOW2)));
  assert.deepEqual(caret(state), { line: TYPED, offset: TYPED.length });
});

test("조합 중인 글자가 든 줄은 병합이 와도 노드를 그대로 둔다", () => {
  const composing = `${MEMO}ㄷ`;
  const sent = docOf(h(TITLE), p(ABOVE), p(MEMO), p(BELOW));
  const current = docOf(SYNCED, p(ABOVE), p(composing), p(BELOW));
  const next = docOf(h(TITLE), p(ABOVE2), p(MEMO), p(BELOW2));
  const { state } = rebased(sent, current, next, posIn(current, composing));
  assert.equal(state.doc.child(2), current.child(2));
  assertBodyIs(state, docOf(h(TITLE), p(ABOVE2), p(composing), p(BELOW2)));
});

test("보낸 뒤 고친 내용이 없으면 서버 문서를 그대로 쓴다", () => {
  const sent = docOf(h(TITLE), p(MEMO));
  const next = docOf(h(TITLE), p(MEMO), p(BELOW));
  assert.equal(rebaseLocalEdits(sent, docOf(SYNCED, p(MEMO)), next), next);
});

test("서버가 줄을 늘리거나 줄여도 친 글자는 있던 줄에 들어간다", () => {
  const sent = docOf(p(ABOVE), p(MEMO), p(BELOW));
  const current = docOf(p(ABOVE), p(TYPED), p(BELOW));
  assert.equal(plain(rebaseLocalEdits(sent, current, docOf(p("새 줄 1"), p("새 줄 2"), p(ABOVE), p(MEMO)))), plain(docOf(p("새 줄 1"), p("새 줄 2"), p(ABOVE), p(TYPED))));
  assert.equal(plain(rebaseLocalEdits(sent, current, docOf(p(MEMO), p(BELOW2)))), plain(docOf(p(TYPED), p(BELOW2))));
});

test("보낸 뒤 줄을 나누거나 지운 것도 서버 병합 결과에 남는다", () => {
  const sent = docOf(p(ABOVE), p(MEMO), p(BELOW));
  const next = docOf(p(ABOVE2), p(MEMO), p(BELOW2));
  assert.equal(plain(rebaseLocalEdits(sent, docOf(p(ABOVE), p(MEMO), p("나눈 줄"), p(BELOW)), next)), plain(docOf(p(ABOVE2), p(MEMO), p("나눈 줄"), p(BELOW2))));
  assert.equal(plain(rebaseLocalEdits(sent, docOf(p(ABOVE), p(BELOW)), next)), plain(docOf(p(ABOVE2), p(BELOW2))));
});

test("문서 맨 앞에 줄을 넣어도 서버 병합 결과에 남는다", () => {
  const sent = docOf(p(MEMO), p(BELOW));
  const next = docOf(p(MEMO), p(BELOW2));
  assert.equal(plain(rebaseLocalEdits(sent, docOf(p("맨 앞"), p(MEMO), p(BELOW)), next)), plain(docOf(p("맨 앞"), p(MEMO), p(BELOW2))));
});

test("서버도 같은 줄을 바꿨으면 그 줄은 사용자 본문을 따른다", () => {
  const sent = docOf(p(ABOVE), p(MEMO), p(BELOW));
  const current = docOf(p(ABOVE), p(TYPED), p(BELOW));
  const next = docOf(p(ABOVE2), p("이 칸은 서버가 고친 메모다.가나"), p(BELOW2));
  assert.equal(plain(rebaseLocalEdits(sent, current, next)), plain(docOf(p(ABOVE2), p(TYPED), p(BELOW2))));
});

test("같은 글자의 줄이 반복되면 친 글자는 있던 쪽 줄에 들어간다", () => {
  const sent = docOf(p("같은 줄"), p("가운데"), p("같은 줄"));
  const current = docOf(p("같은 줄"), p("가운데"), p("같은 줄x"));
  const next = docOf(p("같은 줄"), p("가운데 수정"), p("같은 줄"));
  assert.equal(plain(rebaseLocalEdits(sent, current, next)), plain(docOf(p("같은 줄"), p("가운데 수정"), p("같은 줄x"))));
});

// Milkdown 입력 알림은 마지막 사용자 입력 시점의 문서를 serialize한다. 그 뒤 들어온 서버 병합은 알림 본문에 없다.
test("병합 전 문서로 온 지연 알림은 병합 전 본문을 다시 저장하지 않는다", () => {
  const applied = "AI 수정\n메모 가나다라\nAI 수정";
  assert.equal(resolveEditorBodyUpdate(applied, applied), null);
});

test("병합 뒤 더 친 내용은 알림이 늦어도 지금 문서 기준으로 저장한다", () => {
  const latest = "AI 수정\n메모 가나다라마\nAI 수정";
  assert.equal(resolveEditorBodyUpdate(latest, "AI 수정\n메모 가나다라\nAI 수정"), latest);
});

test("평소 입력 알림은 그 본문을 저장한다", () => {
  assert.equal(resolveEditorBodyUpdate("메모 가", null), "메모 가");
});

test("프로그램 변경의 반향은 저장하지 않는다", () => {
  assert.equal(resolveEditorBodyUpdate("서버 본문", "서버 본문"), null);
});

// Milkdown listener는 addToHistory가 false인 변경을 알리지 않는다. 프로그램 변경을 스스로 기록하지 않으면 입력이 없어도 "아직 알리지 않은 입력"으로 남아 AI 수정 적용과 재조회가 막힌다.
test("서버 병합과 본문 교체는 알림 기준 본문을 직접 갱신한다", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/features/note-editing/ui/NoteEditor.tsx", import.meta.url), "utf8");
  const bodyOf = (name, next) => source.slice(source.indexOf(`const ${name} = useCallback`), source.indexOf(next));
  const merge = bodyOf("mergeEditorMarkdown", "onServerMergeRef.current = (merge)");
  const replace = bodyOf("replaceEditorMarkdown", "const mergeEditorMarkdown = useCallback");
  assert.match(replace, /serializedBodyRef\.current = /);
  assert.match(merge, /serializedBodyRef\.current = /);
  assert.ok(
    merge.indexOf("serializedBodyRef.current = ") < merge.indexOf("if (!tr.docChanged && !hasLocalEdits) return;")
      || /if \(!tr\.docChanged && !hasLocalEdits\) \{[^}]*serializedBodyRef\.current = /.test(merge),
    "문서가 그대로인 병합도 기준 본문을 갱신해야 한다"
  );
});
