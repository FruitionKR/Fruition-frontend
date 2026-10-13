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

const {
  CONFLICT_REGISTERED_MESSAGE,
  CONFLICT_REGISTRATION_FAILED_MESSAGE,
  buildResolveRequest,
  describeConflictRegistration,
  describeResolveError,
  parseVersionConflict
} = await import("../src/features/note-editing/model/editConflict.ts");
const { NoteContentConflictError, saveNoteDraft } = await import("../src/features/note-editing/api/note.ts");
const { useNoteAutosave } = await import("../src/features/note-editing/model/useNoteAutosave.ts");
const { ApiError } = await import("../src/shared/lib/errors.ts");
const { saveAccessToken } = await import("../src/shared/lib/auth.ts");
const { render } = await import("./reactHookShim.mjs");

function workspaceEnv(t) {
  const original = globalThis.window;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: { getItem: (key) => (key === "fruition.workspace_id" ? "ws_test" : null), setItem() {}, removeItem() {} }
  });
  t.after(() => { globalThis.window = original; });
  saveAccessToken("test-access");
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("저장 409 본문에서 메시지와 서버 현재 revision을 읽는다", () => {
  assert.deepEqual(
    parseVersionConflict({ error: { message: "충돌", code: "DOCUMENT_VERSION_CONFLICT", current_revision: 7 } }),
    { message: "충돌", currentRevision: 7 }
  );
  // 구 서버(current_revision 없음)·빈 본문도 깨지지 않는다.
  assert.deepEqual(parseVersionConflict({ error: { message: "충돌" } }), { message: "충돌", currentRevision: null });
  assert.deepEqual(parseVersionConflict(null), { message: null, currentRevision: null });
});

test("해결 요청은 choice별로 base_revision·markdown을 붙인다", () => {
  assert.deepEqual(buildResolveRequest("server", 5), { choice: "server" });
  assert.deepEqual(buildResolveRequest("conflict", 5), { choice: "conflict", base_revision: 5 });
  assert.deepEqual(buildResolveRequest("merged", 5, "# 합친 본문"), { choice: "merged", base_revision: 5, markdown: "# 합친 본문" });
  assert.throws(() => buildResolveRequest("merged", 5), /markdown/);
});

test("해결 실패 문구는 서버 code별로 다음 행동을 안내한다", () => {
  assert.match(describeResolveError(new ApiError("x", 409, "CONFLICT_ALREADY_RESOLVED")), /이미 이 충돌을 해결/);
  assert.match(describeResolveError(new ApiError("x", 409, "DOCUMENT_VERSION_CONFLICT")), /또 바뀌어/);
  assert.match(describeResolveError(new ApiError("x", 423)), /편집 중/);
  assert.match(describeResolveError(new ApiError("x", 404, "EDIT_CONFLICT_NOT_FOUND")), /찾을 수 없/);
  assert.equal(describeResolveError(new Error("네트워크")), "네트워크");
  assert.equal(describeConflictRegistration(true), CONFLICT_REGISTERED_MESSAGE);
  assert.equal(describeConflictRegistration(false), CONFLICT_REGISTRATION_FAILED_MESSAGE);
});

test("saveNoteDraft는 409의 current_revision을 NoteContentConflictError에 담는다", async (t) => {
  workspaceEnv(t);
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { error: { message: "다른 편집 내용이 먼저 저장되었습니다.", code: "DOCUMENT_VERSION_CONFLICT", current_revision: 4 } },
    { status: 409 }
  ));

  const error = await saveNoteDraft("doc_1", "# 본문", 3).then(() => null, (caught) => caught);

  assert.ok(error instanceof NoteContentConflictError);
  assert.equal(error.currentRevision, 4);
});

test("자동 저장이 409를 받으면 내 본문을 충돌로 등록하고 저장을 멈춘다", async (t) => {
  workspaceEnv(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method]);
    if (path.endsWith("/content")) {
      return Response.json({ error: { message: "충돌", code: "DOCUMENT_VERSION_CONFLICT", current_revision: 2 } }, { status: 409 });
    }
    if (path.endsWith("/conflicts")) {
      const body = JSON.parse(init.body);
      assert.equal(body.base_revision, 1);
      assert.match(body.markdown, /내 변경/);
      assert.equal(typeof body.client_conflict_id, "string");
      return Response.json({ id: "conflict_1", status: "open" }, { status: 201 });
    }
    throw new Error(`unexpected ${path}`);
  });

  const hook = render(() => useNoteAutosave({ documentId: "doc_1", marker: "<!-- fruition-note: doc_1 -->", initialVersion: 1 }));
  const saved = await hook.result.saveNow("내 변경");
  await flush();
  hook.rerender();

  assert.equal(saved, false);
  assert.deepEqual(calls.map(([path, method]) => `${method} ${path.split("/").slice(-1)[0]}`), ["PUT content", "POST conflicts"]);
  assert.equal(hook.result.status, "conflict");
  assert.equal(hook.result.errorMessage, CONFLICT_REGISTERED_MESSAGE);
  // 충돌 뒤의 편집은 더 저장하지 않는다.
  assert.equal(await hook.result.saveNow("더 고친 본문"), false);
  assert.equal(calls.length, 2);
});

test("충돌 등록까지 실패하면 본문을 복사해 두라고 안내한다", async (t) => {
  workspaceEnv(t);
  t.mock.method(globalThis, "fetch", async (path) => {
    if (path.endsWith("/content")) return Response.json({ error: { code: "DOCUMENT_VERSION_CONFLICT", current_revision: 2 } }, { status: 409 });
    return Response.json({ error: { message: "서버 오류" } }, { status: 500 });
  });

  const hook = render(() => useNoteAutosave({ documentId: "doc_1", marker: "<!-- fruition-note: doc_1 -->", initialVersion: 1 }));
  await hook.result.saveNow("내 변경");
  await flush();
  hook.rerender();

  assert.equal(hook.result.status, "conflict");
  assert.equal(hook.result.errorMessage, CONFLICT_REGISTRATION_FAILED_MESSAGE);
});

test("저장 중에 더 고친 본문이 있으면 409 충돌 등록에 그 최신 본문을 올린다", async (t) => {
  workspaceEnv(t);
  let conflictBody = null;
  let releaseContent;
  const contentResponse = new Promise((resolve) => { releaseContent = resolve; });
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path.endsWith("/content")) {
      await contentResponse;
      return Response.json({ error: { code: "DOCUMENT_VERSION_CONFLICT", current_revision: 2 } }, { status: 409 });
    }
    if (path.endsWith("/conflicts")) {
      conflictBody = JSON.parse(init.body);
      return Response.json({ id: "conflict_1", status: "open" }, { status: 201 });
    }
    throw new Error(`unexpected ${path}`);
  });

  const hook = render(() => useNoteAutosave({ documentId: "doc_1", marker: "<!-- fruition-note: doc_1 -->", initialVersion: 1 }));
  const first = hook.result.saveNow("첫 본문");
  // 첫 저장이 서버 응답을 기다리는 동안 사용자가 더 고친다. 이 본문은 pending으로 합쳐진다.
  const second = hook.result.saveNow("첫 본문\n\n더 고친 본문");
  releaseContent();
  await Promise.all([first, second]);
  await flush();

  assert.ok(conflictBody);
  assert.match(conflictBody.markdown, /더 고친 본문/);
});
