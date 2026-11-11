import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const stub = (code) => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "react") return next(new URL("./reactHookShim.mjs", import.meta.url).href, context);
  if (specifier === "next-intl") return next(new URL("./fakeNextIntl.mjs", import.meta.url).href, context);
  if (specifier === "@/entities/document") return stub(`
    export function fetchDocumentBlocks(id) { return new Promise((resolve, reject) => globalThis.pendingBlocks.push({ id, resolve, reject })); }
    export async function reflectDocumentToWiki() { globalThis.reflectCalls++; }
  `);
  if (specifier === "@/entities/workspace") return stub('export function useSelectedWorkspace() { return { auto_ingest_on_upload: false }; }');
  if (specifier.endsWith("/useWikiActionPermissions")) return stub('export function useWikiActionPermissions() { return { canIngest: true }; }');
  if (specifier === "@/features/document-notifications") return stub('export function publishNotice() {}');
  if (specifier === "@/shared/lib/authSessionStorage") return stub('export function getSelectedWorkspaceId() { return globalThis.workspaceId; }');
  if (specifier === "@/shared/lib/apiErrors") return stub('export function getErrorMessage() { return "error"; }');
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { render } = await import("./reactHookShim.mjs");
const { useConvertedIngestPrompt } = await import("../src/widgets/workspace/model/useConvertedIngestPrompt.ts");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const converted = (id = "doc-1") => ({ id, filename: "paper.md", mime_type: "text/markdown", document_role: "EDITABLE", source_document_id: "pdf-1", status: "completed", pipeline_run_id: "convert:1", needs_reingest: false });
function setup() {
  globalThis.pendingBlocks = [];
  globalThis.reflectCalls = 0;
  globalThis.workspaceId = "ws-1";
  globalThis.window = { sessionStorage: { getItem: () => null, setItem: () => {} } };
  const props = { documents: [converted()], openDocumentId: "doc-1", pendingDocumentIds: [], refreshBackendData: async () => {} };
  const hook = render(() => useConvertedIngestPrompt(props));
  return { props, hook };
}

test("MCP 편입 근거가 있으면 convert 실행 ID가 남아도 안내하지 않는다", async () => {
  for (const response of [{ source_content_hash: "hash", blocks: [] }, { blocks: [{ block_id: "B0001" }] }]) {
    const { hook } = setup();
    assert.equal(hook.result.target, null);
    pendingBlocks[0].resolve(response);
    await flush(); hook.rerender();
    assert.equal(hook.result.target, null);
    assert.equal(reflectCalls, 0);
    hook.unmount();
  }
});

test("근거 없는 변환본만 안내하고 편입 상태 갱신 시 닫는다", async () => {
  const { props, hook } = setup();
  pendingBlocks[0].resolve({ source_content_hash: null, blocks: [] });
  await flush(); hook.rerender();
  assert.equal(hook.result.target.id, "doc-1");
  props.documents = [converted()];
  hook.rerender();
  assert.equal(hook.result.target.id, "doc-1");
  props.documents = [{ ...converted(), pipeline_run_id: "ingest:1" }];
  hook.rerender();
  assert.equal(hook.result.target, null);
  hook.result.confirm();
  assert.equal(reflectCalls, 0);
  hook.unmount();
});

test("근거 조회 실패는 미편입 안내로 바꾸지 않는다", async () => {
  const { hook } = setup();
  pendingBlocks[0].reject(new Error("unavailable"));
  await flush(); hook.rerender();
  assert.equal(hook.result.target, null);
  hook.unmount();
});

test("문서 전환 전의 늦은 조회 응답은 안내를 열지 않는다", async () => {
  const { props, hook } = setup();
  props.openDocumentId = "doc-2";
  props.documents = [converted("doc-2")];
  hook.rerender();
  pendingBlocks[0].resolve({ blocks: [] });
  await flush(); hook.rerender();
  assert.equal(hook.result.target, null);
  pendingBlocks[1].resolve({ blocks: [] });
  await flush(); hook.rerender();
  assert.equal(hook.result.target.id, "doc-2");
  hook.unmount();
});

test("워크스페이스 전환 전의 조회 응답은 무시한다", async () => {
  const { hook } = setup();
  globalThis.workspaceId = "ws-2";
  pendingBlocks[0].resolve({ blocks: [] });
  await flush(); hook.rerender();
  assert.equal(hook.result.target, null);
  hook.unmount();
});
