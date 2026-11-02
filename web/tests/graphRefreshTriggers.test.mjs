import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });

const { hasSettledDocuments, GRAPH_IDLE_POLL_INTERVAL_MS, GRAPH_REFRESH_DEBOUNCE_MS } =
  await import("../src/widgets/workspace/model/graphRefreshTriggers.ts");

const doc = (id, status, processing_state, processed_at) => ({
  id, status, ...(processing_state ? { processing_state } : {}), ...(processed_at ? { processed_at } : {})
});

test("파이프라인이 돌던 문서가 completed가 되면 그래프를 다시 받는다", () => {
  assert.equal(hasSettledDocuments([doc("a", "processing", "running")], [doc("a", "completed", "completed")]), true);
  // processing_state만 돌던 재편입도 같다.
  assert.equal(hasSettledDocuments([doc("a", "completed", "running")], [doc("a", "completed", "completed")]), true);
});

test("진행 중 상태를 폴링 사이에 놓쳐도(다른 멤버·다른 탭의 편입) completed로 바뀌면 다시 받는다", () => {
  assert.equal(hasSettledDocuments([doc("a", "uploaded")], [doc("a", "completed", "completed")]), true);
  assert.equal(hasSettledDocuments([doc("a", "failed", "failed")], [doc("a", "completed", "completed")]), true);
  // 이미 편입된 문서를 다시 편입하면 status는 그대로 completed이고 processed_at만 바뀐다.
  assert.equal(
    hasSettledDocuments([doc("a", "completed", "completed", "2026-11-02T00:00:00Z")], [doc("a", "completed", "completed", "2026-11-02T00:05:00Z")]),
    true
  );
});

test("파이프라인이 실패·업로드 상태로 끝나도 그래프를 다시 받는다(실패 전에 만든 페이지가 있을 수 있다)", () => {
  assert.equal(hasSettledDocuments([doc("a", "processing", "running")], [doc("a", "failed", "failed")]), true);
  assert.equal(hasSettledDocuments([doc("a", "completed", "running")], [doc("a", "completed", "failed")]), true);
  assert.equal(hasSettledDocuments([doc("a", "processing", "running")], [doc("a", "uploaded", "completed")]), true);
});

test("아직 진행 중이거나, 진행 중 상태를 거치지 않고 실패·업로드로 바뀐 문서는 다시 받지 않는다", () => {
  assert.equal(hasSettledDocuments([doc("a", "processing", "starting")], [doc("a", "processing", "running")]), false);
  assert.equal(hasSettledDocuments([doc("a", "uploaded")], [doc("a", "failed", "failed")]), false);
  assert.equal(hasSettledDocuments([doc("a", "failed", "failed")], [doc("a", "failed", "failed")]), false);
});

test("이미 끝나 있던 문서나 처음 보는 문서는 전환으로 보지 않는다", () => {
  assert.equal(hasSettledDocuments([doc("a", "completed")], [doc("a", "completed")]), false);
  assert.equal(hasSettledDocuments([doc("a", "completed", "completed", "t1")], [doc("a", "completed", "completed", "t1")]), false);
  assert.equal(hasSettledDocuments([], [doc("b", "completed")]), false);
});

test("여러 문서가 같은 폴링에서 끝나도 한 번의 판단(true)이다", () => {
  const previous = [doc("a", "processing", "running"), doc("b", "processing", "running"), doc("c", "uploaded")];
  const current = [doc("a", "completed", "completed"), doc("b", "completed", "completed"), doc("c", "uploaded")];
  assert.equal(hasSettledDocuments(previous, current), true);
});

test("idle 안전 폴링은 문서 목록 idle 주기(15초)보다 길고, 묶음 debounce는 1초 안팎이다", () => {
  assert.ok(GRAPH_IDLE_POLL_INTERVAL_MS >= 15_000);
  assert.ok(GRAPH_REFRESH_DEBOUNCE_MS > 0 && GRAPH_REFRESH_DEBOUNCE_MS <= 1_000);
});

const { hasGraphDataChanged } = await import("../src/widgets/workspace/model/graphRefreshTriggers.ts");

test("hasGraphDataChanged: 노드·링크·문서 상태가 같으면 순서가 달라도 바뀌지 않은 것으로 본다", () => {
  const before = {
    graph: { nodes: [{ id: "p1" }, { id: "p2" }], edges: [{ from_page_id: "p1", to_page_id: "p2", link_type: "related" }] },
    documents: [doc("a", "completed", "completed", "t1"), doc("b", "uploaded")]
  };
  const after = {
    graph: { nodes: [{ id: "p2" }, { id: "p1" }], edges: [{ from_page_id: "p1", to_page_id: "p2", link_type: "related" }] },
    documents: [doc("b", "uploaded"), doc("a", "completed", "completed", "t1")]
  };
  assert.equal(hasGraphDataChanged(before, after), false);
});

test("hasGraphDataChanged: 노드·링크가 늘거나 문서가 추가·완료되면 바뀐 것으로 본다", () => {
  const base = { graph: { nodes: [{ id: "p1" }], edges: [] }, documents: [doc("a", "uploaded")] };
  assert.equal(hasGraphDataChanged(base, { ...base, graph: { nodes: [{ id: "p1" }, { id: "p2" }], edges: [] } }), true);
  assert.equal(hasGraphDataChanged(base, { ...base, graph: { nodes: [{ id: "p1" }], edges: [{ from_page_id: "p1", to_page_id: "p1", link_type: "x" }] } }), true);
  assert.equal(hasGraphDataChanged(base, { ...base, documents: [doc("a", "completed", "completed")] }), true);
  assert.equal(hasGraphDataChanged(base, { ...base, documents: [doc("a", "uploaded"), doc("c", "uploaded")] }), true);
  assert.equal(hasGraphDataChanged(undefined, base), true, "이전 데이터가 없으면 바뀐 것으로 본다");
});
