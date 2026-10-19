import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// 앱의 TypeScript 경로 별칭을 같은 소스로 해석하고, react는 1회 렌더 shim으로 바꿔 훅을 실제로 실행한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react") return nextResolve(new URL("./reactHookShim.mjs", import.meta.url).href, context);
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const { useNoteAutosave } = await import("../src/features/note-editing/model/useNoteAutosave.ts");
const { parseSaveMerge, saveNoteDraft } = await import("../src/features/note-editing/api/note.ts");
const { LEGACY_CONFLICT_MESSAGE } = await import("../src/features/note-editing/model/saveMerge.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
const { render } = await import("./reactHookShim.mjs");

const DOCUMENT_ID = "doc_merge";
const MARKER = "<!-- fruition-note: doc_merge -->";

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

/**
 * 저장 PUT은 respond(요청)로 응답을 정하고, 문서 상세 GET은 latestVersion을 돌려준다.
 * 보낸 base_revision과 본문을 기록한다.
 */
function mockServer(t, respond, { latestVersion = 20 } = {}) {
  const saves = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (!init?.method || init.method === "GET") {
      return Response.json({ id: DOCUMENT_ID, markdown: `${MARKER}\n서버 본문\n`, current_version: latestVersion, edit_revision: latestVersion, updated_at: "2026-10-19T00:00:00Z" });
    }
    const request = {
      base: Number(init.body.get("base_revision")),
      markdown: await init.body.get("markdown").text()
    };
    saves.push(request);
    return respond(request, saves.length);
  });
  return saves;
}

function saved(version, extra = {}) {
  return Response.json({ document_id: DOCUMENT_ID, current_version: version, updated_at: "2026-10-19T00:00:00Z", ...extra });
}

function renderAutosave(merges) {
  const box = render(() => useNoteAutosave({
    documentId: DOCUMENT_ID,
    marker: MARKER,
    initialVersion: 7,
    autoSave: true,
    onServerMerge: (merge) => merges.push(merge)
  }));
  return {
    get autosave() {
      box.rerender();
      return box.result;
    }
  };
}

test("merge 필드는 merged·overwritten만 병합으로 읽고 none·누락은 null이다", () => {
  assert.equal(parseSaveMerge(undefined), null);
  assert.equal(parseSaveMerge({ status: "none" }), null);
  assert.equal(parseSaveMerge({ status: "weird" }), null);
  assert.deepEqual(
    parseSaveMerge({ status: "overwritten", base_version: 10, server_version: 12, overwritten_version: 12 }),
    { status: "overwritten", baseVersion: 10, serverVersion: 12, overwrittenVersion: 12 }
  );
  assert.deepEqual(parseSaveMerge({ status: "merged", base_version: 10 }), { status: "merged", baseVersion: 10, serverVersion: null, overwrittenVersion: null });
});

test("saveNoteDraft는 병합 응답의 최종 본문과 버전을 돌려준다", async (t) => {
  workspaceEnv(t);
  mockServer(t, () => saved(13, { markdown: `${MARKER}\n합친 본문\n`, merge: { status: "merged", base_version: 10, server_version: 12, overwritten_version: null } }));

  const result = await saveNoteDraft(DOCUMENT_ID, `${MARKER}\n내 본문\n`, 10);

  assert.equal(result.content_version, 13);
  assert.equal(result.markdown, `${MARKER}\n합친 본문\n`);
  assert.equal(result.merge.status, "merged");
});

test("병합 저장 뒤 더 고친 내용이 없으면 편집기에 서버 본문을 넣고 새 버전을 기준으로 이어서 저장한다", async (t) => {
  workspaceEnv(t);
  const saves = mockServer(t, (_request, count) => count === 1
    ? saved(13, { markdown: `${MARKER}\n합친 본문\n`, merge: { status: "merged", base_version: 7, server_version: 12, overwritten_version: null } })
    : saved(14));
  const merges = [];
  const view = renderAutosave(merges);

  assert.equal(await view.autosave.saveNow("내 본문"), true);
  assert.deepEqual(merges, [{ status: "merged", markdown: `${MARKER}\n합친 본문\n`, notify: false }]);
  assert.equal(view.autosave.status, "saved");
  assert.equal(view.autosave.contentVersion, 13);

  assert.equal(await view.autosave.saveNow("합친 본문 더"), true);
  assert.equal(saves[1].base, 13, "병합된 버전을 기준으로 보낸다");
});

test("덮어쓰기 응답은 버전 기록 안내를 같은 덮인 버전에 한 번만 요청한다", async (t) => {
  workspaceEnv(t);
  mockServer(t, (_request, count) => saved(12 + count, {
    markdown: `${MARKER}\n내 본문 ${count}\n`,
    merge: { status: "overwritten", base_version: 7, server_version: 12, overwritten_version: 12 }
  }));
  const merges = [];
  const view = renderAutosave(merges);

  await view.autosave.saveNow("내 본문 1");
  await view.autosave.saveNow("내 본문 2");

  assert.deepEqual(merges.map((merge) => [merge.status, merge.notify]), [["overwritten", true], ["overwritten", false]]);
  assert.equal(view.autosave.status, "saved", "덮어써도 저장은 막지 않는다");
});

test("저장 중에 더 고쳤으면 편집기 본문을 바꾸지 않고 다음 저장이 같은 기준 버전으로 다시 병합된다", async (t) => {
  workspaceEnv(t);
  let releaseFirst;
  const firstResponse = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const saves = mockServer(t, (_request, count) => count === 1
    ? firstResponse
    : saved(14, { markdown: `${MARKER}\n최종\n`, merge: { status: "merged", base_version: 7, server_version: 13, overwritten_version: null } }));
  const merges = [];
  const view = renderAutosave(merges);

  const first = view.autosave.saveNow("첫 입력");
  await new Promise((resolve) => setImmediate(resolve));
  const second = view.autosave.saveNow("첫 입력 그리고 더");
  releaseFirst(saved(13, { markdown: `${MARKER}\n첫 입력 + 다른 곳\n`, merge: { status: "merged", base_version: 7, server_version: 12, overwritten_version: null } }));
  await first;
  await second;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(saves.length, 2);
  assert.equal(saves[1].base, 7, "편집기에 아직 없는 다른 곳의 변경을 잃지 않도록 기준 버전을 유지한다");
  assert.deepEqual(merges.map((merge) => merge.markdown), [null, `${MARKER}\n최종\n`]);
});

test("구 서버 409를 받으면 최신 버전을 다시 받아 지금 본문으로 한 번 다시 저장하고 덮어쓰기를 안내한다", async (t) => {
  workspaceEnv(t);
  const saves = mockServer(t, (request) => request.base === 20
    ? saved(21)
    : Response.json({ error: { message: "다른 편집 내용이 먼저 저장되었습니다.", code: "DOCUMENT_VERSION_CONFLICT", current_revision: 19 } }, { status: 409 }));
  const merges = [];
  const view = renderAutosave(merges);

  await view.autosave.saveNow("내 본문");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(saves.map((save) => save.base), [7, 20], "다시 받은 최신 버전(20)을 기준으로 보낸다");
  assert.match(saves[1].markdown, /내 본문/);
  assert.equal(view.autosave.status, "saved");
  assert.deepEqual(merges, [{ status: "overwritten", markdown: null, notify: true }]);
});

test("구 서버 409가 다시 저장해도 이어지면 안내만 하고 저장을 막지 않는다", async (t) => {
  workspaceEnv(t);
  let conflicts = 2;
  const saves = mockServer(t, () => (conflicts-- > 0
    ? Response.json({ error: { message: "충돌", code: "DOCUMENT_VERSION_CONFLICT" } }, { status: 409 })
    : saved(30)));
  const merges = [];
  const view = renderAutosave(merges);

  await view.autosave.saveNow("내 본문");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(view.autosave.status, "error");
  assert.equal(view.autosave.errorMessage, LEGACY_CONFLICT_MESSAGE);

  assert.equal(await view.autosave.saveNow("내 본문 다시"), true, "다음 저장은 그대로 나간다");
  assert.equal(saves.length, 3);
  assert.equal(view.autosave.status, "saved");
});
