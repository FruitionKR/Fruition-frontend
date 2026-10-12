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
const { saveAccessToken } = await import("../src/shared/lib/auth.ts");
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
    documentId: DOCUMENT_ID,
    marker: "<!-- note -->",
    initialVersion: 7,
    autoSave: current.autoSave
  }));
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
