import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// 기존 변환 시작 이벤트 구독이 되살아나도 완료 시 자동 이동하는 회귀를 잡는다.
const listeners = new Set();
globalThis.__conversionNavigationListeners = listeners;
const documentStub = `data:text/javascript,${encodeURIComponent(`
  export function subscribeConvertStarted(listener) {
    globalThis.__conversionNavigationListeners.add(listener);
    return () => globalThis.__conversionNavigationListeners.delete(listener);
  }
`)}`;
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "react") return next(new URL("./reactHookShim.mjs", import.meta.url).href, context);
  if (specifier === "@/entities/document") return { url: documentStub, shortCircuit: true };
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { render } = await import("./reactHookShim.mjs");
const { usePendingDocumentOpen } = await import("../src/widgets/workspace/model/usePendingDocumentOpen.ts");

function setup(t, selectedDocumentId) {
  listeners.clear();
  const opened = [];
  const selected = [];
  const refreshes = [];
  const props = {
    documents: [], projects: [],
    selection: { selectedDocumentId, selectTreeGraphNode(item) { selected.push(item.documentId); return item; } },
    openDocument: (item) => opened.push(item.documentId),
    refreshBackendData: async (options) => { refreshes.push(options); }
  };
  const hook = render(() => usePendingDocumentOpen(props));
  t.after(() => hook.unmount());
  function update(ids, status, treeReady = true) {
    props.documents = ids.map((id) => ({ id, status, pipeline_run_id: `convert:${id}`, source_document_id: "pdf" }));
    props.projects = treeReady ? [{ items: ids.map((id) => ({ id, documentId: id, label: id, type: "file" })) }] : [];
    hook.rerender();
  }
  function start(ids) {
    for (const id of ids) for (const listener of listeners) listener(id);
    hook.rerender();
  }
  return { hook, props, opened, selected, refreshes, start, update };
}

for (const current of ["other-document", "pdf"]) {
  test(`PDF 변환 완료는 현재 문서(${current})와 채팅 문맥을 바꾸는 선택·이동을 하지 않는다`, (t) => {
    const state = setup(t, current);
    state.start(["converted"]);
    state.update(["converted"], "processing");
    state.update(["converted"], "completed");
    state.hook.rerender();
    assert.deepEqual(state.selected, []);
    assert.deepEqual(state.opened, []);
    assert.equal(state.props.selection.selectedDocumentId, current);
  });
}

test("병렬 변환 완료와 늦은 트리 갱신도 문서를 자동으로 열지 않는다", (t) => {
  const state = setup(t, "other-document");
  state.start(["converted-a", "converted-b"]);
  state.update(["converted-a", "converted-b"], "completed", false);
  state.update(["converted-a", "converted-b"], "completed");
  state.hook.rerender();
  state.hook.rerender();
  assert.deepEqual(state.opened, []);
  assert.deepEqual(state.selected, []);
});

test("실패한 변환은 문서를 열지 않는다", (t) => {
  const state = setup(t, "pdf");
  state.start(["converted"]);
  state.update(["converted"], "failed");
  assert.deepEqual(state.opened, []);
});

for (const action of ["openSavedDocument", "handleChatDocumentExported"]) {
  test(`${action}의 명시적인 저장 문서 열기는 트리 갱신 후 한 번 유지한다`, async (t) => {
    const state = setup(t, "other-document");
    await state.hook.result[action](action === "openSavedDocument" ? "saved" : { exportDocumentId: "saved" });
    assert.deepEqual(state.refreshes, [{ throwOnError: true }]);
    state.update(["saved"], "completed", false);
    assert.deepEqual(state.opened, []);
    state.update(["saved"], "completed");
    state.hook.rerender();
    assert.deepEqual(state.opened, ["saved"]);
    assert.deepEqual(state.selected, ["saved"]);
  });
}
