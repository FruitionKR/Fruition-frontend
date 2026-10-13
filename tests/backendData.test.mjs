import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { browserEnv, createResolver, render, setPageVisible } from "./asyncHookShim.mjs";

registerHooks({
  resolve: createResolver({
    "@tanstack/react-query": new URL("./fakeReactQuery.mjs", import.meta.url).href
  })
});

const { useBackendData } = await import("../src/widgets/workspace/model/useBackendData.ts");
const {
  lastOptions, queries, refetchCalls, resetFakeQueries, setQueryDataCalls
} = await import("./fakeReactQuery.mjs");
const {
  ACTIVE_WIKI_WORK_POLL_INTERVAL_MS,
  HIDDEN_ACTIVE_WIKI_WORK_POLL_INTERVAL_MS,
  IDLE_WIKI_WORK_POLL_INTERVAL_MS
} = await import("../src/features/wiki-ingest/model/wikiWorkPolling.ts");
const { ROOT_DOCUMENTS_PROJECT_ID } = await import("../src/entities/tree/lib/serverTree.ts");

function doc(id, status = "completed") {
  return {
    id, filename: `${id}.md`, mime_type: "text/markdown", byte_size: 1, status,
    source_uri: `s3://${id}`, uploaded_at: "2026-10-12T00:00:00Z", document_role: "EDITABLE"
  };
}

function treeItem(document) {
  return { type: "document", id: document.id, name: document.filename, sort_order: 0, current_version: 1, document };
}

/** 선택된 워크스페이스가 있는 환경에서 훅을 렌더하고 setProjects 호출을 기록한다. */
function renderBackendData(t) {
  const env = browserEnv(t);
  resetFakeQueries();
  const projectUpdates = [];
  const setProjects = (update) => projectUpdates.push(update);
  const view = render(() => useBackendData({ setProjects }));
  return {
    ...env,
    projectUpdates,
    get data() { return view.rerender(); },
    unmount: view.unmount
  };
}

test("문서 목록을 받기 전에는 렌더마다 같은 빈 배열을 돌려준다", (t) => {
  const view = renderBackendData(t);

  const first = view.data;
  const second = view.data;

  assert.deepEqual(first.documents, []);
  assert.equal(first.documents, second.documents, "새 []를 돌려주면 documents에 묶인 memo·effect가 매 렌더 무효화된다");
  assert.equal(first.wikiGraph, second.wikiGraph);
  assert.deepEqual(first.wikiGraph, { nodes: [], edges: [] });
  assert.equal(first.isGraphLoading, true);
  assert.equal(first.apiError, null);
  assert.equal(lastOptions.documents.enabled, true);
  assert.deepEqual(lastOptions.documents.queryKey, ["backendData", "ws_test", "documents"]);
});

test("워크스페이스를 고르지 않았으면 두 쿼리를 모두 끈다", (t) => {
  const view = renderBackendData(t);
  view.storage.delete("fruition.workspace_id");

  view.data;

  assert.equal(lastOptions.documents.enabled, false);
  assert.equal(lastOptions.graph.enabled, false);
});

test("처리 중인 문서가 있으면 짧게 폴링하고 숨김 탭에서는 문서 쿼리만 느리게 이어 간다", (t) => {
  const view = renderBackendData(t);
  queries.documents = { data: { documents: [doc("d1", "processing")], tree: [] }, error: null, isLoading: false, dataUpdatedAt: 1 };
  view.data;

  const activeQuery = { state: queries.documents };
  assert.equal(lastOptions.documents.refetchInterval(activeQuery), ACTIVE_WIKI_WORK_POLL_INTERVAL_MS);
  assert.equal(lastOptions.graph.refetchInterval, ACTIVE_WIKI_WORK_POLL_INTERVAL_MS);
  assert.equal(lastOptions.documents.refetchIntervalInBackground, true, "완료 브라우저 알림을 위해 숨김 탭에서도 받는다");
  assert.equal(lastOptions.graph.refetchIntervalInBackground, false, "그래프는 알림에 쓰이지 않아 숨김 탭에서 멈춘다");

  setPageVisible(false);
  view.data;
  assert.equal(lastOptions.documents.refetchInterval(activeQuery), HIDDEN_ACTIVE_WIKI_WORK_POLL_INTERVAL_MS);
});

test("처리 중인 문서가 없으면 보이는 탭에서만 느리게 폴링하고 복귀 시 오래된 데이터만 다시 받는다", (t) => {
  const view = renderBackendData(t);
  queries.documents = { data: { documents: [doc("d1")], tree: [] }, error: null, isLoading: false, dataUpdatedAt: 1 };
  view.data;

  const activeQuery = { state: queries.documents };
  assert.equal(lastOptions.documents.refetchInterval(activeQuery), IDLE_WIKI_WORK_POLL_INTERVAL_MS);
  assert.equal(lastOptions.graph.refetchInterval, IDLE_WIKI_WORK_POLL_INTERVAL_MS);

  setPageVisible(false);
  view.data;
  assert.equal(lastOptions.documents.refetchInterval(activeQuery), false);
  assert.equal(lastOptions.graph.refetchInterval, false);

  const now = Date.now();
  const fresh = { state: { dataUpdatedAt: now - IDLE_WIKI_WORK_POLL_INTERVAL_MS + 1_000 } };
  const stale = { state: { dataUpdatedAt: now - IDLE_WIKI_WORK_POLL_INTERVAL_MS - 1_000 } };
  for (const name of ["documents", "graph"]) {
    assert.equal(lastOptions[name].refetchOnWindowFocus(fresh), false, `${name}: 방금 받은 데이터는 다시 받지 않는다`);
    assert.equal(lastOptions[name].refetchOnWindowFocus(stale), true, `${name}: 숨김 동안 오래된 데이터는 바로 받는다`);
  }
});

test("서버 트리가 도착하면 프로젝트 트리에 병합하고 응답 데이터를 그대로 돌려준다", (t) => {
  const view = renderBackendData(t);
  assert.equal(view.projectUpdates.length, 0, "트리가 없으면 병합하지 않는다");

  const d1 = doc("d1");
  queries.documents = { data: { documents: [d1], tree: [treeItem(d1)] }, error: null, isLoading: false, dataUpdatedAt: 42 };
  queries.graph = { data: { nodes: [{ id: "n1" }], edges: [] }, error: null, isLoading: false, dataUpdatedAt: 42 };
  const data = view.data;

  assert.equal(data.documents, queries.documents.data.documents);
  assert.equal(data.documentsUpdatedAt, 42);
  assert.deepEqual(data.wikiGraph, { nodes: [{ id: "n1" }], edges: [] });
  assert.equal(data.isGraphLoading, false);
  assert.equal(view.projectUpdates.length, 1);
  const projects = view.projectUpdates[0]([]);
  assert.equal(projects[0].id, ROOT_DOCUMENTS_PROJECT_ID);
  assert.deepEqual(projects[0].items.map((item) => item.documentId), ["d1"]);

  // 같은 데이터로 다시 렌더하면 병합을 반복하지 않는다.
  view.data;
  assert.equal(view.projectUpdates.length, 1);
});

test("refreshBackendData는 문서·그래프를 함께 다시 받고 받은 트리를 바로 병합한다", async (t) => {
  const view = renderBackendData(t);
  const d1 = doc("d1");
  queries.documents = { data: { documents: [d1], tree: [treeItem(d1)] }, error: null, isLoading: false, dataUpdatedAt: 1 };
  const data = view.data;
  const before = view.projectUpdates.length;

  await data.refreshBackendData({ throwOnError: true });

  assert.deepEqual(refetchCalls, [["documents", { throwOnError: true }], ["graph", undefined]]);
  assert.equal(view.projectUpdates.length, before + 1, "트리 변경 큐가 렌더를 기다리지 않도록 바로 병합한다");
  assert.deepEqual(view.projectUpdates.at(-1)([])[0].items.map((item) => item.documentId), ["d1"]);
});

test("setDocuments는 query cache의 documents만 바꾸고 캐시가 비어 있으면 빈 목록에서 시작한다", (t) => {
  const view = renderBackendData(t);
  const data = view.data;

  data.setDocuments((current) => [...current, doc("new")]);
  assert.deepEqual(setQueryDataCalls.at(-1), [
    ["backendData", "ws_test", "documents"],
    { documents: [doc("new")] }
  ]);

  queries.documents = { data: { documents: [doc("d1")], tree: [treeItem(doc("d1"))] }, error: null, isLoading: false, dataUpdatedAt: 1 };
  data.setDocuments([doc("d2")]);
  const [, next] = setQueryDataCalls.at(-1);
  assert.deepEqual(next.documents, [doc("d2")]);
  assert.deepEqual(next.tree, [treeItem(doc("d1"))], "트리는 그대로 둔다");
});

test("문서나 그래프 요청이 실패하면 그 오류 문구를 apiError로 돌려준다", (t) => {
  const view = renderBackendData(t);

  queries.graph = { data: undefined, error: new Error("그래프 서버 오류"), isLoading: false, dataUpdatedAt: 0 };
  assert.equal(view.data.apiError, "그래프 서버 오류");

  queries.documents = { data: undefined, error: new Error("문서 서버 오류"), isLoading: false, dataUpdatedAt: 0 };
  assert.equal(view.data.apiError, "문서 서버 오류", "문서 오류를 먼저 보여준다");

  queries.documents = { data: undefined, error: "알 수 없음", isLoading: false, dataUpdatedAt: 0 };
  queries.graph = { data: undefined, error: null, isLoading: false, dataUpdatedAt: 0 };
  assert.equal(view.data.apiError, "백엔드 데이터를 불러오지 못했습니다.");
});
