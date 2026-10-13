import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// react는 1회 렌더 shim으로 바꿔 훅을 실제로 실행하고, 문서 API·알림은 호출만 기록하는 stub으로 바꾼다.
const calls = { convert: [], reflect: [], notices: [] };
globalThis.__pdfIngestStub = calls;
const STUB_DOCUMENT = `data:text/javascript,${encodeURIComponent(`
  export async function convertDocumentToMarkdown(id) { globalThis.__pdfIngestStub.convert.push(id); return { id }; }
  export function reflectDocumentToWiki(id) {
    return new Promise((resolve, reject) => { globalThis.__pdfIngestStub.reflect.push({ id, resolve, reject }); });
  }
`)}`;
const STUB_NOTICES = `data:text/javascript,${encodeURIComponent(`
  export function publishNotice(notice) { globalThis.__pdfIngestStub.notices.push(notice); }
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react") return nextResolve(new URL("./reactHookShim.mjs", import.meta.url).href, context);
    if (specifier === "@/entities/document") return { url: STUB_DOCUMENT, shortCircuit: true };
    if (specifier === "@/features/document-notifications") return { url: STUB_NOTICES, shortCircuit: true };
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key)
  };
}

globalThis.window = { localStorage: memoryStorage(), sessionStorage: memoryStorage() };

const { render } = await import("./reactHookShim.mjs");
const { setSelectedWorkspaceId } = await import("../src/shared/lib/authSessionStorage.ts");
const { usePdfWikiIngest } = await import("../src/features/wiki-ingest/model/usePdfWikiIngest.ts");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function completedDocument(id) {
  return { id, filename: `${id}.pdf`, status: "completed", needs_reingest: true, pipeline_run_id: "convert:1", document_role: "EDITABLE" };
}

test.beforeEach(() => {
  calls.convert.length = 0;
  calls.reflect.length = 0;
  calls.notices.length = 0;
  globalThis.window.sessionStorage = memoryStorage();
});

test("대기 목록은 마운트 시점이 아니라 현재 선택된 워크스페이스의 저장소에서 읽는다", () => {
  setSelectedWorkspaceId("ws-a");
  window.sessionStorage.setItem("fruition.pdf-wiki-ingest.ws-a", JSON.stringify([{ documentId: "doc-a", filename: "a.pdf" }]));
  window.sessionStorage.setItem("fruition.pdf-wiki-ingest.ws-b", JSON.stringify([{ documentId: "doc-b", filename: "b.pdf" }]));

  const hook = render(() => usePdfWikiIngest([], async () => {}, 0));
  hook.rerender();
  assert.equal(hook.result.isPending, true);

  // 워크스페이스를 바꾸면 새 워크스페이스의 대기 목록으로 갈아탄다.
  setSelectedWorkspaceId("ws-b");
  hook.rerender();
  hook.rerender();
  assert.equal(hook.result.isPending, true);
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem("fruition.pdf-wiki-ingest.ws-a")), [{ documentId: "doc-a", filename: "a.pdf" }]);
});

test("편입 요청 응답이 돌아오기 전에 워크스페이스가 바뀌면 바뀐 워크스페이스의 목록·화면을 건드리지 않는다", async () => {
  setSelectedWorkspaceId("ws-a");
  window.sessionStorage.setItem("fruition.pdf-wiki-ingest.ws-a", JSON.stringify([{ documentId: "doc-a", filename: "a.pdf" }]));
  window.sessionStorage.setItem("fruition.pdf-wiki-ingest.ws-b", JSON.stringify([{ documentId: "doc-b", filename: "b.pdf" }]));
  let refreshCount = 0;
  const refresh = async () => { refreshCount += 1; };
  let documents = [];
  let updatedAt = 0;

  const hook = render(() => usePdfWikiIngest(documents, refresh, updatedAt));
  hook.rerender();
  // ws-a의 변환 완료 문서가 내려와 편입 요청이 시작된다(응답은 아직 미해결).
  documents = [completedDocument("doc-a")];
  updatedAt = 1;
  hook.rerender();
  await flush();
  assert.equal(calls.reflect.length, 1);
  assert.equal(calls.reflect[0].id, "doc-a");

  // 응답 전에 ws-b로 바꾼다. ws-b의 대기 목록이 올라온다.
  setSelectedWorkspaceId("ws-b");
  documents = [];
  updatedAt = 2;
  hook.rerender();
  hook.rerender();
  assert.equal(hook.result.isPending, true);

  // 이전 워크스페이스의 응답이 돌아와도 ws-b의 목록은 그대로고 화면 새로고침도 하지 않는다.
  calls.reflect[0].resolve();
  await flush();
  await flush();
  hook.rerender();
  assert.equal(hook.result.isPending, true);
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem("fruition.pdf-wiki-ingest.ws-b")), [{ documentId: "doc-b", filename: "b.pdf" }]);
  assert.equal(refreshCount, 0);
  assert.equal(calls.notices.filter((notice) => notice.kind === "completed").length, 1);
});

test("워크스페이스가 그대로면 편입 완료 후 대기 목록을 비우고 화면을 새로고침한다", async () => {
  setSelectedWorkspaceId("ws-a");
  window.sessionStorage.setItem("fruition.pdf-wiki-ingest.ws-a", JSON.stringify([{ documentId: "doc-a", filename: "a.pdf" }]));
  let refreshCount = 0;
  const refresh = async () => { refreshCount += 1; };
  let documents = [];
  let updatedAt = 0;

  const hook = render(() => usePdfWikiIngest(documents, refresh, updatedAt));
  hook.rerender();
  documents = [completedDocument("doc-a")];
  updatedAt = 1;
  hook.rerender();
  await flush();
  calls.reflect[0].resolve();
  await flush();
  await flush();
  hook.rerender();
  assert.equal(hook.result.isPending, false);
  assert.equal(window.sessionStorage.getItem("fruition.pdf-wiki-ingest.ws-a"), "[]");
  assert.equal(refreshCount, 1);
});
