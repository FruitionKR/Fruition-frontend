import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { advance, createResolver, render } from "./asyncHookShim.mjs";

const fakeDeps = new URL("./fakeWikiActionDeps.mjs", import.meta.url).href;
registerHooks({
  resolve: createResolver({
    "@/entities/document": new URL("./fakeDocumentEntity.mjs", import.meta.url).href,
    "@/features/document-notifications": fakeDeps,
    "@/features/wiki-ingest/model/useWikiActionPermissions": fakeDeps
  })
});

const { getWikiActionGate, WIKI_INGEST_PERMISSION_HINT, WIKI_LINT_PERMISSION_HINT } = await import(
  "../src/features/wiki-ingest/model/wikiActionPermission.ts"
);
const { useGraphWikiActions } = await import("../src/widgets/workspace/model/useGraphWikiActions.ts");
const { reflectCalls, setReflectFailure } = await import("./fakeDocumentEntity.mjs");
const { lintCalls, notices, wikiActionPermissions } = await import("./fakeWikiActionDeps.mjs");

const note = { id: "n1", filename: "n1.md", mime_type: "text/markdown", status: "uploaded", document_role: "EDITABLE" };

function renderActions(permissions) {
  Object.assign(wikiActionPermissions, permissions);
  reflectCalls.length = 0;
  lintCalls.length = 0;
  notices.length = 0;
  setReflectFailure(null);
  const pdfWikiIngest = { startPdfIngest: async () => { throw new Error("PDF 경로는 이 테스트에서 쓰지 않는다"); }, isPending: false };
  return render(() => useGraphWikiActions({ documents: [note], pdfWikiIngest, refreshBackendData: async () => {} }));
}

test("권한이 있으면 막지 않고, 없으면 막고 사유를 보여 주며, 확인 중이면 사유 없이 막는다", () => {
  assert.deepEqual(getWikiActionGate(true, "ingest"), { isBlocked: false, hint: null });
  assert.deepEqual(getWikiActionGate(false, "ingest"), { isBlocked: true, hint: WIKI_INGEST_PERMISSION_HINT });
  assert.deepEqual(getWikiActionGate(false, "lint"), { isBlocked: true, hint: WIKI_LINT_PERMISSION_HINT });
  assert.deepEqual(getWikiActionGate(null, "ingest"), { isBlocked: true, hint: null });
  assert.equal(WIKI_INGEST_PERMISSION_HINT, "위키 편입 권한이 없어요");
  assert.equal(WIKI_LINT_PERMISSION_HINT, "위키 최신화 권한이 없어요");
});

test("편입·최신화 권한이 있으면 요청을 그대로 보낸다", async (t) => {
  const view = renderActions({ canIngest: true, canLint: true });
  view.result.requestGraphIngest([note]);
  await advance(t, 0);
  assert.deepEqual(reflectCalls, [["n1", "EDITABLE"]]);

  view.rerender();
  await view.result.handleGraphLint();
  assert.deepEqual(lintCalls, ["status", "lint"]);
});

for (const [label, permission] of [["권한이 없으면", false], ["역할을 확인하는 중이면", null]]) {
  test(`${label} 어느 진입점에서 불러도 편입·최신화 요청을 보내지 않는다(403 방지)`, async (t) => {
    const view = renderActions({ canIngest: permission, canLint: permission });
    view.result.requestGraphIngest([note]);
    await advance(t, 0);
    await view.result.handleGraphLint();
    assert.deepEqual(reflectCalls, []);
    assert.deepEqual(lintCalls, []);
    assert.deepEqual(notices, [], "실패 알림도 띄우지 않는다");
    assert.equal(view.result.pdfIngestConfirmation, null);
  });
}
