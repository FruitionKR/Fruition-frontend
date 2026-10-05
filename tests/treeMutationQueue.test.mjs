import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// 앱의 TypeScript 경로 별칭을 같은 소스로 해석하고, react는 훅 shim으로 바꿔 훅을 실제로 실행한다.
import { existsSync } from "node:fs";

/** 확장자 없는 모듈 경로를 .ts 파일 또는 디렉터리 index.ts로 해석한다. */
function resolveSource(href) {
  return existsSync(new URL(`${href}.ts`)) ? `${href}.ts` : `${href}/index.ts`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react") {
      return nextResolve(new URL("./reactHookShim.mjs", import.meta.url).href, context);
    }
    // 알림 버스만 필요하고 배럴은 .tsx 컴포넌트를 끌고 오므로 버스 모듈로 직접 연결한다.
    if (specifier === "@/features/document-notifications") {
      return nextResolve(new URL("../src/features/document-notifications/model/noticeBus.ts", import.meta.url).href, context);
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(resolveSource(new URL(`../src/${specifier.slice(2)}`, import.meta.url).href), context);
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(resolveSource(new URL(specifier, context.parentURL).href), context);
    }
    return nextResolve(specifier, context);
  }
});

const { createSerialQueue } = await import("../src/shared/lib/serialQueue.ts");
const { useProjectTree } = await import("../src/widgets/workspace/model/useProjectTree.ts");
const { subscribeNotices } = await import("../src/features/document-notifications/model/noticeBus.ts");
const { saveAccessToken } = await import("../src/shared/lib/auth.ts");
const { render } = await import("./reactHookShim.mjs");

test("직렬 큐는 진행 중인 작업이 있어도 다음 작업을 버리지 않고 순서대로 실행한다", async () => {
  const enqueue = createSerialQueue();
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = enqueue(async () => {
    order.push("first-start");
    await firstGate;
    order.push("first-end");
  });
  const second = enqueue(async () => { order.push("second"); });

  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("직렬 큐는 앞 작업이 실패해도 뒤 작업을 계속 실행한다", async () => {
  const enqueue = createSerialQueue();
  let ran = false;
  const failing = enqueue(async () => { throw new Error("boom"); });
  const next = enqueue(async () => { ran = true; });

  await assert.rejects(failing);
  await next;

  assert.ok(ran, "앞 작업의 실패가 큐를 멈추지 않는다");
});

function domEnv(t) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    localStorage: {
      getItem: (key) => (key === "fruition.workspace_id" ? "ws_test" : null),
      setItem() {},
      removeItem() {}
    }
  };
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });
  saveAccessToken("test-access");
}

const PDF_ITEM = {
  id: "item_pdf",
  label: "원본.pdf",
  type: "file",
  status: "completed",
  documentId: "doc_pdf",
  mimeType: "application/pdf"
};

test("다른 트리 변경이 진행 중이어도 Markdown 변환 요청은 버려지지 않는다", async (t) => {
  domEnv(t);
  const requested = [];
  let releaseSlowMutation;
  t.mock.method(globalThis, "fetch", async (path) => {
    requested.push(path);
    if (path.endsWith("/folders")) {
      // 먼저 시작한 변경이 끝나지 않은 동안 변환 메뉴를 누르는 상황을 만든다.
      await new Promise((resolve) => { releaseSlowMutation = resolve; });
      return Response.json({ id: "folder_1", name: "새 폴더" });
    }
    return Response.json({ id: "doc_md" });
  });

  const refreshRef = { current: async () => {} };
  const view = render(() => useProjectTree({ refreshRef }));

  view.result.setProjects([
    { id: "project-uploaded-documents", folderId: null, title: "문서", items: [PDF_ITEM] }
  ]);
  view.result.openFolderMenu(
    { preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 },
    "project-uploaded-documents",
    PDF_ITEM.id
  );
  const opened = view.rerender();
  assert.ok(opened.convertContextTarget, "PDF 원본에서는 변환 메뉴가 보인다");

  // 폴더 생성이 서버 응답을 기다리는 동안 변환을 요청한다.
  opened.addProject();
  await new Promise((resolve) => setTimeout(resolve, 0));
  opened.convertContextTargetToMarkdown();

  releaseSlowMutation();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(
    requested.some((path) => path.endsWith("/convert-markdown")),
    `진행 중인 변경이 있어도 변환 요청은 전송된다 (requested=${requested.join(", ")})`
  );
});

test("Markdown 변환 실패는 알림으로 보고된다", async (t) => {
  domEnv(t);
  t.mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({ error: { message: "이미 변환 중입니다." } }),
    { status: 409, headers: { "Content-Type": "application/json" } }
  ));
  const notices = [];
  const unsubscribe = subscribeNotices((notice) => notices.push(notice));
  t.after(unsubscribe);

  const refreshRef = { current: async () => {} };
  const view = render(() => useProjectTree({ refreshRef }));
  view.result.setProjects([
    { id: "project-uploaded-documents", folderId: null, title: "문서", items: [PDF_ITEM] }
  ]);
  view.result.openFolderMenu(
    { preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 },
    "project-uploaded-documents",
    PDF_ITEM.id
  );
  const opened = view.rerender();

  opened.convertContextTargetToMarkdown();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(notices.length, 1, "실패는 조용히 묻히지 않는다");
  assert.equal(notices[0].title, "Markdown 변환 실패");
  assert.equal(notices[0].message, "이미 변환 중입니다.");
});
