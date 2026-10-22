import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// 앱의 TypeScript 경로 별칭을 같은 소스로 해석하고, react는 1회 렌더 shim으로 바꿔 훅을 실제로 실행한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react") {
      return nextResolve(new URL("./reactHookShim.mjs", import.meta.url).href, context);
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const { useNoteAutosave } = await import("../src/features/note-editing/model/useNoteAutosave.ts");
const { reflectDocumentToWiki } = await import("../src/entities/document/api/document.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
const { render } = await import("./reactHookShim.mjs");

const DOCUMENT_ID = "doc_autosave";
// useNoteAutosave의 디바운스(AUTOSAVE_DELAY_MS)보다 넉넉히 기다린다.
const PAST_DEBOUNCE_MS = 1_000;

/** 저장 API는 선택된 워크스페이스와 access token을 쓰고, beforeunload는 window에 붙는다. */
function workspaceEnv(t) {
  const original = globalThis.window;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key) => (key === "fruition.workspace_id" ? "ws_test" : null),
      setItem() {},
      removeItem() {}
    }
  });
  t.after(() => {
    globalThis.window = original;
  });
  saveAccessToken("test-access");
}

/** 본문 저장(PUT content) 요청만 세고, 저장된 본문을 돌려준다. */
function mockSaveApi(t) {
  const saved = [];
  let version = 7;
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    const markdown = init.body instanceof FormData ? await init.body.get("markdown")?.text?.() : undefined;
    saved.push(markdown ?? "");
    version += 1;
    return Response.json({ document_id: DOCUMENT_ID, current_version: version, updated_at: "2026-10-11T00:00:00Z" });
  });
  return saved;
}

/** 가짜 타이머를 앞으로 돌리고, 그 사이 시작된 저장 요청이 끝나기를 기다린다. */
async function advance(t, ms) {
  t.mock.timers.tick(ms);
  await new Promise((resolve) => setImmediate(resolve));
}

function renderAutosave(props) {
  const current = { autoSave: props.autoSave };
  const box = render(() => useNoteAutosave({
    documentId: props.documentId ?? DOCUMENT_ID,
    marker: "<!-- note -->",
    initialVersion: 7,
    beforeFlush: props.beforeFlush,
    autoSave: current.autoSave
  }));
  if (props.t) {
    const testWindow = globalThis.window;
    props.t.after(() => {
      const previous = globalThis.window;
      globalThis.window = testWindow;
      try { box.unmount(); } finally { globalThis.window = previous; }
    });
  }
  return {
    get autosave() {
      return box.result;
    },
    setAutoSave(next) {
      current.autoSave = next;
      box.rerender();
    },
    unmount: box.unmount
  };
}

test("자동 저장이 켜져 있으면 입력 뒤 디바운스가 지나면 저장한다", async (t) => {
  workspaceEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saved = mockSaveApi(t);
  const view = renderAutosave({ autoSave: true });

  view.autosave.queueSave("켜진 상태 입력");
  await advance(t, PAST_DEBOUNCE_MS);

  assert.equal(saved.length, 1);
  assert.match(saved[0], /켜진 상태 입력/);
});

function mockIngestSaveApi(t, { defer = false, fail = false } = {}) {
  const requests = [];
  const saves = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    requests.push({ path: String(path), method: init.method, body: init.body });
    if (init.method === "PUT") {
      if (defer) await new Promise((resolve) => saves.push(resolve));
      if (fail) return Response.json({ error: { code: "SAVE_FAILED", message: "저장 실패" } }, { status: 500 });
      return Response.json({ document_id: DOCUMENT_ID, current_version: 8 + requests.length, updated_at: "2026-10-21T00:00:00Z" });
    }
    return new Response(null, { status: 202 });
  });
  return { requests, saves };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("편집 직후 위키 편입은 디바운스 본문 저장이 성공한 뒤에 요청한다", async (t) => {
  workspaceEnv(t);
  const api = mockIngestSaveApi(t, { defer: true });
  const view = renderAutosave({ autoSave: true, t });
  view.autosave.queueSave("편입할 최신 본문");
  const ingest = reflectDocumentToWiki(DOCUMENT_ID, "EDITABLE");
  await settle();
  assert.deepEqual(api.requests.map((r) => r.method), ["PUT"]);
  api.saves.shift()();
  await ingest;
  assert.deepEqual(api.requests.map((r) => r.method), ["PUT", "POST"]);
  assert.match(api.requests[1].path, /\/ingest$/);
});

test("위키 편입은 이미 진행 중인 저장과 그 뒤의 최신 입력까지 기다린다", async (t) => {
  workspaceEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = mockIngestSaveApi(t, { defer: true });
  const view = renderAutosave({ autoSave: true, t });
  view.autosave.queueSave("먼저 저장 중인 본문");
  await advance(t, PAST_DEBOUNCE_MS);
  view.autosave.queueSave("저장 중 더 고친 본문");
  const ingest = reflectDocumentToWiki(DOCUMENT_ID, "EDITABLE");
  await settle();
  assert.deepEqual(api.requests.map((r) => r.method), ["PUT"]);
  api.saves.shift()();
  await settle();
  assert.deepEqual(api.requests.map((r) => r.method), ["PUT", "PUT"]);
  assert.match(await api.requests[1].body.get("markdown").text(), /저장 중 더 고친 본문/);
  api.saves.shift()();
  await ingest;
  assert.deepEqual(api.requests.map((r) => r.method), ["PUT", "PUT", "POST"]);
});

test("자동 저장을 꺼도 위키 편입 전에 미저장 본문을 저장한다", async (t) => {
  workspaceEnv(t);
  const api = mockIngestSaveApi(t);
  const view = renderAutosave({ autoSave: false, t });
  view.autosave.queueSave("수동 저장 모드의 본문");
  await reflectDocumentToWiki(DOCUMENT_ID, "EDITABLE");
  assert.deepEqual(api.requests.map((r) => r.method), ["PUT", "POST"]);
});

test("저장에 실패하면 이전 본문으로 위키 편입을 시작하지 않는다", async (t) => {
  workspaceEnv(t);
  const api = mockIngestSaveApi(t, { fail: true });
  const view = renderAutosave({ autoSave: true, t });
  view.autosave.queueSave("저장 실패하는 본문");
  await assert.rejects(reflectDocumentToWiki(DOCUMENT_ID, "EDITABLE"), /저장하지 못해 위키 편입/);
  assert.deepEqual(api.requests.map((r) => r.method), ["PUT"]);
});

test("편집기 변경 알림이 아직 오지 않아도 최신 본문을 읽어 저장한 뒤 편입한다", async (t) => {
  workspaceEnv(t);
  const api = mockIngestSaveApi(t);
  let synchronized = false;
  const view = renderAutosave({ autoSave: true, t, beforeFlush() {
    if (synchronized) return;
    synchronized = true;
    view.autosave.queueSave("변경 알림 전 편집기의 최신 본문");
  } });
  await reflectDocumentToWiki(DOCUMENT_ID, "EDITABLE");
  assert.deepEqual(api.requests.map((r) => r.method), ["PUT", "POST"]);
  assert.match(await api.requests[0].body.get("markdown").text(), /편집기의 최신 본문/);
});

test("자동 저장을 끄면 입력해도 디바운스가 지나도 저장하지 않는다", async (t) => {
  workspaceEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saved = mockSaveApi(t);
  const view = renderAutosave({ autoSave: false });

  view.autosave.queueSave("꺼진 상태 입력");
  await advance(t, PAST_DEBOUNCE_MS * 5);

  assert.equal(saved.length, 0);
});

test("자동 저장을 꺼도 Cmd/Ctrl+S(saveNow)는 바로 저장한다", async (t) => {
  workspaceEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saved = mockSaveApi(t);
  const view = renderAutosave({ autoSave: false });

  view.autosave.queueSave("저장 전 입력");
  assert.equal(await view.autosave.saveNow("직접 저장한 본문"), true);
  await advance(t, PAST_DEBOUNCE_MS);

  assert.equal(saved.length, 1, "예약해 둔 입력분을 따로 한 번 더 보내지 않는다");
  assert.match(saved[0], /직접 저장한 본문/);
});

test("자동 저장을 끈 채 다른 문서로 이동(언마운트)하면 남은 입력분을 저장한다", async (t) => {
  workspaceEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saved = mockSaveApi(t);
  const view = renderAutosave({ autoSave: false });

  view.autosave.queueSave("이동 직전 입력");
  view.unmount();
  await advance(t, 0);

  assert.equal(saved.length, 1);
  assert.match(saved[0], /이동 직전 입력/);
});

test("자동 저장을 다시 켜면 그동안 쌓인 입력분을 디바운스 뒤 이어서 저장한다", async (t) => {
  workspaceEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saved = mockSaveApi(t);
  const view = renderAutosave({ autoSave: false });

  view.autosave.queueSave("꺼진 동안 입력");
  await advance(t, PAST_DEBOUNCE_MS);
  assert.equal(saved.length, 0);

  view.setAutoSave(true);
  await advance(t, PAST_DEBOUNCE_MS);

  assert.equal(saved.length, 1);
  assert.match(saved[0], /꺼진 동안 입력/);
});

test("자동 저장을 끈 채 저장하지 않은 입력이 있을 때만 탭을 닫기 전에 확인을 요청한다", async (t) => {
  workspaceEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mockSaveApi(t);
  const closeTab = () => {
    const event = new Event("beforeunload", { cancelable: true });
    globalThis.window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  const offView = renderAutosave({ autoSave: false });
  assert.equal(closeTab(), false, "입력이 없으면 묻지 않는다");
  offView.autosave.queueSave("저장 안 된 입력");
  assert.equal(closeTab(), true);
  assert.equal(await offView.autosave.saveNow("저장 안 된 입력"), true);
  assert.equal(closeTab(), false, "저장한 뒤에는 묻지 않는다");
  offView.unmount();

  const onView = renderAutosave({ autoSave: true });
  onView.autosave.queueSave("자동 저장 대기 입력");
  assert.equal(closeTab(), false, "자동 저장이 켜져 있으면 묻지 않는다");
  onView.unmount();
});

test("편입 전 저장 실패 후에도 이탈 경고와 문서 이동 저장을 유지한다", async (t) => {
  workspaceEnv(t);
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    bodies.push(await init.body.get("markdown").text());
    if (bodies.length === 1) return Response.json({ error: { message: "저장 실패" } }, { status: 500 });
    return Response.json({ document_id: DOCUMENT_ID, current_version: 8 });
  });
  const view = renderAutosave({ autoSave: false });
  view.autosave.queueSave("잃으면 안 되는 최신 본문");
  await assert.rejects(reflectDocumentToWiki(DOCUMENT_ID, "EDITABLE"), /저장하지 못해/);
  const close = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(close);
  assert.equal(close.defaultPrevented, true);
  view.unmount();
  await settle();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1], bodies[0]);
});

test("미저장 입력이 없으면 편집 잠금 상실과 관계없이 서버 본문을 편입한다", async (t) => {
  workspaceEnv(t);
  const api = mockIngestSaveApi(t);
  const view = renderAutosave({ autoSave: true, t });
  view.autosave.reportSaveBlock("lock-lost", "잠금을 잃었습니다.");
  await reflectDocumentToWiki(DOCUMENT_ID, "EDITABLE");
  assert.deepEqual(api.requests.map((request) => request.method), ["POST"]);
});

test("잠금을 잃기 전의 미저장 입력이 있으면 편입을 계속 막는다", async (t) => {
  workspaceEnv(t);
  const api = mockIngestSaveApi(t);
  const documentId = "doc_lock_dirty";
  const view = renderAutosave({ autoSave: false, documentId, t });
  view.autosave.queueSave("아직 저장되지 않은 본문");
  view.autosave.reportSaveBlock("lock-lost", "잠금을 잃었습니다.");
  await assert.rejects(reflectDocumentToWiki(documentId, "EDITABLE"), /저장하지 못해/);
  assert.deepEqual(api.requests, []);
});

test("이전 저장 도중 잠금을 잃고 이동해도 버려진 최신 입력이 있으면 편입을 막는다", async (t) => {
  workspaceEnv(t);
  const api = mockIngestSaveApi(t, { defer: true });
  const documentId = "doc_lock_pending";
  const view = renderAutosave({ autoSave: false, documentId });
  const saving = view.autosave.saveNow("이전 본문");
  await settle();
  view.autosave.queueSave("잠금 상실 직전 최신 본문");
  view.autosave.reportSaveBlock("lock-lost", "잠금을 잃었습니다.");
  view.unmount();
  api.saves.shift()();
  await saving;
  await assert.rejects(reflectDocumentToWiki(documentId, "EDITABLE"), /저장하지 못해/);
  assert.deepEqual(api.requests.map((request) => request.method), ["PUT"]);
});
