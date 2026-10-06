import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});
const { fetchDocumentBlocks } = await import("../src/entities/document/api/document.ts");
const { resolveSourceBlockRanges } = await import("../src/entities/document/lib/sourceBlockRanges.ts");

function selectWorkspace(t) {
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
}

test("block 목록은 워크스페이스 문서 경로로 캐시 없이 조회한다", async (t) => {
  selectWorkspace(t);
  const response = {
    document_id: "doc_1",
    source_content_hash: "a",
    current_content_hash: "a",
    is_stale: false,
    blocks: [{ block_id: "B0001", position: 1, line_start: 1, line_end: 1, block_type: "heading", text: "# 제목" }]
  };
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/workspaces/ws_test/documents/doc_1/blocks");
    assert.equal(init?.cache, "no-store");
    return Response.json(response);
  });
  assert.deepEqual(await fetchDocumentBlocks("doc_1"), response);
});

test("구 응답에서 blocks가 없거나 null이면 빈 목록으로 맞추고 해시·is_stale 없이도 쓸 수 있다", async (t) => {
  selectWorkspace(t);
  const bodies = [{ document_id: "doc_1" }, { document_id: "doc_1", blocks: null }];
  t.mock.method(globalThis, "fetch", async () => Response.json(bodies.shift()));

  for (let index = 0; index < 2; index += 1) {
    const result = await fetchDocumentBlocks("doc_1");
    assert.deepEqual(result.blocks, []);
    assert.deepEqual(resolveSourceBlockRanges("# 제목", result, ["B0001"]), { ranges: [], missingBlockIds: ["B0001"] });
  }
});

test("구 block 형식(text만 있음)은 그대로 넘겨 텍스트 대조로 위치를 찾는다", async (t) => {
  selectWorkspace(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({
    document_id: "doc_1",
    blocks: [{ block_id: "B0002", text: "본문 문단" }]
  }));
  const result = await fetchDocumentBlocks("doc_1");
  assert.equal(result.is_stale, undefined);
  assert.deepEqual(resolveSourceBlockRanges(["# 제목", "", "본문 문단"].join("\n"), result, ["B0002"]).ranges, [
    { blockId: "B0002", startLine: 3, endLine: 3 }
  ]);
});

test("조회 실패는 오류로 전달한다", async (t) => {
  selectWorkspace(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "AI 서버 오류" } }, { status: 503 }));
  await assert.rejects(fetchDocumentBlocks("doc_1"));
});
