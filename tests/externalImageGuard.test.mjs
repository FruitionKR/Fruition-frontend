import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
const { Schema, Slice, Fragment } = await import("@milkdown/prose/model");
const { EditorState, Plugin, PluginKey, TextSelection } = await import("@milkdown/prose/state");
const {
  ALLOW_EXTERNAL_IMAGES_META,
  blockedImagePlaceholderUrl,
  countExternalImages,
  createExternalImageGuard,
  createExternalImagePasteHandler,
  stripExternalImages
} = await import("../src/features/note-editing/model/externalImageGuard.ts");

// Crepe와 같은 이름의 이미지 노드만 갖춘 최소 schema
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    "image-block": { group: "block", atom: true, attrs: { src: { default: "" } } },
    text: { group: "inline" },
    image: { group: "inline", inline: true, atom: true, attrs: { src: { default: "" } } }
  }
});
const p = (...content) => schema.node("paragraph", null, content);
const text = (value) => schema.text(value);
const image = (src) => schema.node("image", { src });
const block = (src) => schema.node("image-block", { src });
const EXTERNAL = "https://attacker.example/p.png?q=secret";
const MANAGED = "/api/workspaces/ws/assets/a1/content";

function setup(doc, extraPlugins = []) {
  const blocked = [];
  const guard = createExternalImageGuard(() => blocked.push(true));
  const state = EditorState.create({ doc, plugins: [...extraPlugins, guard] });
  return { state, blocked };
}

test("외부 이미지 수를 세고 그 노드만 뺀다", () => {
  const doc = schema.node("doc", null, [p(text("앞"), image(EXTERNAL), image(MANAGED)), block("//cdn.example/a.png"), block(MANAGED)]);
  assert.equal(countExternalImages(doc), 2);
  const stripped = stripExternalImages(doc.content);
  assert.equal(countExternalImages(stripped), 0);
  assert.equal(stripped.childCount, 2);
  assert.equal(stripped.child(0).textContent, "앞");
  assert.equal(stripped.child(0).childCount, 2);
  assert.equal(stripped.child(1).attrs.src, MANAGED);
});

test("입력·링크 입력처럼 외부 이미지를 새로 넣는 변경은 거부하고 알린다", () => {
  const { state, blocked } = setup(schema.node("doc", null, [p(text("본문"))]));
  const inserted = state.applyTransaction(state.tr.insert(1, image(EXTERNAL)));
  assert.equal(inserted.state.doc.eq(state.doc), true);
  assert.equal(blocked.length, 1);

  const emptyBlock = EditorState.create({ doc: schema.node("doc", null, [block("")]), plugins: state.plugins });
  const linked = emptyBlock.applyTransaction(emptyBlock.tr.setNodeAttribute(0, "src", EXTERNAL));
  assert.equal(linked.state.doc.firstChild.attrs.src, "");
  assert.equal(blocked.length, 2);
});

test("관리 이미지 추가, 기존 외부 이미지 이동·삭제, undo, 프로그램 교체는 허용한다", () => {
  const history = new Plugin({ key: new PluginKey("history") });
  const doc = schema.node("doc", null, [p(text("가"), image(EXTERNAL)), p(text("나"))]);
  const { state, blocked } = setup(doc, [history]);

  const managed = state.applyTransaction(state.tr.insert(1, image(MANAGED)));
  assert.equal(managed.state.doc.firstChild.childCount, 3);

  const imagePos = 2;
  const moved = state.applyTransaction(state.tr.delete(imagePos, imagePos + 1).insert(5, image(EXTERNAL)));
  assert.equal(countExternalImages(moved.state.doc), 1);
  assert.notEqual(moved.state.doc.eq(state.doc), true);

  const removed = state.applyTransaction(state.tr.delete(imagePos, imagePos + 1)).state;
  const undo = removed.applyTransaction(removed.tr.insert(imagePos, image(EXTERNAL)).setMeta(history, { redo: false }));
  assert.equal(countExternalImages(undo.state.doc), 1);

  const replaced = state.applyTransaction(state.tr.insert(1, image("https://ai.example/x.png")).setMeta(ALLOW_EXTERNAL_IMAGES_META, true));
  assert.equal(countExternalImages(replaced.state.doc), 2);
  assert.equal(blocked.length, 0);
});

function pasteInto(state, { html = "", plain = "", slice = Slice.empty, parse = () => null }) {
  const view = { state, dispatch(tr) { view.state = view.state.apply(tr); } };
  const blocked = [];
  const handle = createExternalImagePasteHandler(parse, () => blocked.push(true));
  const event = { clipboardData: { getData: (type) => (type === "text/html" ? html : type === "text/plain" ? plain : "") } };
  return { handled: handle(view, event, slice), view, blocked };
}

test("markdown 글 붙여넣기는 노드로만 파싱해 외부 이미지를 빼고 넣는다", () => {
  const empty = EditorState.create({ doc: schema.node("doc", null, [p()]) });
  const state = empty.apply(empty.tr.setSelection(TextSelection.create(empty.doc, 1)));
  const parsed = schema.node("doc", null, [p(text("요약 "), image(EXTERNAL))]);
  const { handled, view, blocked } = pasteInto(state, { plain: `요약 ![](${EXTERNAL})`, parse: () => parsed });
  assert.equal(handled, true);
  assert.equal(blocked.length, 1);
  assert.equal(countExternalImages(view.state.doc), 0);
  assert.match(view.state.doc.textContent, /요약/);
});

test("HTML 붙여넣기는 미리 읽힌 slice에서 외부 이미지만 뺀다", () => {
  const state = EditorState.create({ doc: schema.node("doc", null, [p()]) });
  const slice = new Slice(Fragment.from(p(text("웹 글"), image(EXTERNAL))), 1, 1);
  const { handled, view } = pasteInto(state, { html: `<p>웹 글<img src="${EXTERNAL}"></p>`, slice });
  assert.equal(handled, true);
  assert.equal(countExternalImages(view.state.doc), 0);
  assert.match(view.state.doc.textContent, /웹 글/);
});

test("외부 이미지가 없으면 붙여넣기를 Milkdown 기본 처리에 넘긴다", () => {
  const state = EditorState.create({ doc: schema.node("doc", null, [p()]) });
  const parsed = schema.node("doc", null, [p(text("글"), image(MANAGED))]);
  assert.equal(pasteInto(state, { plain: "글", parse: () => parsed }).handled, false);
  assert.equal(pasteInto(state, { plain: "", html: "" }).handled, false);
});

test("편집기 자리 표시 그림은 네트워크 요청 없는 data URL이고 host를 이스케이프한다", () => {
  const url = blockedImagePlaceholderUrl("a.example");
  assert.match(url, /^data:image\/svg\+xml;charset=utf-8,/);
  const svg = decodeURIComponent(url.slice(url.indexOf(",") + 1));
  assert.match(svg, /외부 이미지는 표시하지 않습니다 · a\.example/);
  assert.doesNotMatch(svg, /href=|<image|url\(/);
  assert.match(decodeURIComponent(blockedImagePlaceholderUrl("<x>&")), /&#60;x&#62;&#38;/);
  assert.match(decodeURIComponent(blockedImagePlaceholderUrl(null)), /표시할 수 없는 이미지입니다/);
});
