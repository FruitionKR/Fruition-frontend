import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { documentsFromTree, fetchDocumentData, fetchWikiGraph } = await import("../src/entities/wiki/api/wiki.ts");

test("그래프 API가 실패해도 문서와 서버 폴더 트리는 독립적으로 조회한다", async t => {
  globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
  t.after(() => { delete globalThis.window; });
  const items = [{ id: "folder", type: "folder", name: "Folder", children: [{ id: "doc", type: "document", name: "a.md", sort_order: 0, document: { id: "doc" } }] }];
  t.mock.method(globalThis, "fetch", async path => {
    if (path.endsWith("/wiki/graph")) return Response.json({ error: { message: "AI unavailable" } }, { status: 500 });
    if (path.endsWith("/document-tree")) return Response.json({ items });
    throw new Error(`Unexpected path: ${path}`);
  });
  const results = await Promise.allSettled([fetchDocumentData(), fetchWikiGraph()]);
  assert.equal(results[0].status, "fulfilled");
  assert.deepEqual(results[0].value, { documents: [{ id: "doc" }], tree: items });
  assert.equal(results[1].status, "rejected");
});

test("문서 목록은 documents를 따로 받지 않고 트리 한 번으로 만든다", async t => {
  globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
  t.after(() => { delete globalThis.window; });
  const paths = [];
  t.mock.method(globalThis, "fetch", async path => {
    paths.push(path);
    return Response.json({ items: [] });
  });
  await fetchDocumentData();
  assert.deepEqual(paths, ["/api/workspaces/ws_test/document-tree"]);
});

test("문서 목록 조회가 실패하면 폴더가 아니라 문서 목록 실패 문구를 쓴다", async t => {
  globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
  t.after(() => { delete globalThis.window; });
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 500 }));
  await assert.rejects(fetchDocumentData(), { message: "문서 목록을 불러오지 못했습니다." });
});

test("트리 문서를 서버 목록과 같은 sort_order·id 순으로 평탄화하고 폴더는 뺀다", () => {
  const doc = (id, sortOrder) => ({ id, type: "document", name: `${id}.md`, sort_order: sortOrder, document: { id, status: "ready" } });
  const items = [
    { id: "f1", type: "folder", name: "F", sort_order: 0, children: [doc("doc_b", 1), doc("doc_c", 0)] },
    doc("doc_a", 1),
    { id: "doc_x", type: "document", name: "x.md", sort_order: 0 }
  ];
  assert.deepEqual(documentsFromTree(items).map(document => document.id), ["doc_c", "doc_a", "doc_b"]);
});
