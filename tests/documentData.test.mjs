import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { fetchDocumentData, fetchWikiGraph } = await import("../src/entities/wiki/api/wiki.ts");

test("그래프 API가 실패해도 문서와 서버 폴더 트리는 독립적으로 조회한다", async t => {
  globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
  t.after(() => { delete globalThis.window; });
  const items = [{ id: "folder", type: "folder", name: "Folder", children: [] }];
  t.mock.method(globalThis, "fetch", async path => {
    if (path.endsWith("/wiki/graph")) return Response.json({ error: { message: "AI unavailable" } }, { status: 500 });
    if (path.endsWith("/documents")) return Response.json({ documents: [{ id: "doc" }] });
    if (path.endsWith("/document-tree")) return Response.json({ items });
    throw new Error(`Unexpected path: ${path}`);
  });
  const results = await Promise.allSettled([fetchDocumentData(), fetchWikiGraph()]);
  assert.equal(results[0].status, "fulfilled");
  assert.deepEqual(results[0].value, { documents: [{ id: "doc" }], tree: items });
  assert.equal(results[1].status, "rejected");
});
