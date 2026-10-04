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

const {
  EditLockHeldError,
  EditLockLostError,
  acquireEditLock,
  releaseEditLock,
  sendEditLockHeartbeat
} = await import("../src/features/note-editing/api/editLock.ts");
const {
  HEARTBEAT_FALLBACK_MS,
  HEARTBEAT_MAX_MS,
  HEARTBEAT_MIN_MS,
  describeEditLockHolder,
  resolveHeartbeatDelayMs
} = await import("../src/features/note-editing/model/editLockSchedule.ts");
const { useNoteAutosave } = await import("../src/features/note-editing/model/useNoteAutosave.ts");
const { ERROR_MESSAGES } = await import("../src/shared/api/client.ts");
const { saveAccessToken } = await import("../src/shared/lib/auth.ts");
const { render } = await import("./reactHookShim.mjs");

const DOCUMENT_ID = "doc_edit_lock";
const LOCK_PATH = `/api/workspaces/ws_test/documents/${DOCUMENT_ID}/edit-lock`;

/** 편집 잠금 API는 선택된 워크스페이스와 access token을 쓴다. */
function workspaceEnv(t) {
  const original = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => (key === "fruition.workspace_id" ? "ws_test" : null),
      setItem() {},
      removeItem() {}
    }
  };
  t.after(() => {
    globalThis.window = original;
  });
  saveAccessToken("test-access");
}

test("편집기 진입 시 잠금을 POST로 획득하고 만료 시각을 돌려준다", async (t) => {
  workspaceEnv(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method]);
    return Response.json({
      expires_at: "2026-10-04T00:01:00Z",
      holder_display_name: "나",
      holder_user_id: "user_me"
    });
  });

  const lock = await acquireEditLock(DOCUMENT_ID);

  assert.deepEqual(calls, [[LOCK_PATH, "POST"]]);
  assert.equal(lock.expires_at, "2026-10-04T00:01:00Z");
  assert.equal(lock.holder_display_name, "나");
});

test("다른 사용자가 편집 중이면 423 보유자 정보를 담아 EditLockHeldError를 던진다", async (t) => {
  workspaceEnv(t);
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { expires_at: "2026-10-04T00:01:00Z", holder_display_name: "김편집", holder_user_id: "user_other" },
    { status: 423 }
  ));

  const error = await acquireEditLock(DOCUMENT_ID).then(() => null, (caught) => caught);

  assert.ok(error instanceof EditLockHeldError);
  assert.equal(error.lock.holder_display_name, "김편집");
  assert.equal(error.message, "김편집님이 편집 중입니다.");
});

test("보유자 이름이 없는 423도 편집 중임을 알린다", async (t) => {
  workspaceEnv(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 423 }));

  const error = await acquireEditLock(DOCUMENT_ID).then(() => null, (caught) => caught);

  assert.ok(error instanceof EditLockHeldError);
  assert.equal(error.message, ERROR_MESSAGES.editLockHeld);
  assert.equal(describeEditLockHolder(error.lock), ERROR_MESSAGES.editLockHeld);
});

test("403·404는 서버 상세를 노출하지 않고 정해진 안내 문구로 바꾼다", async (t) => {
  workspaceEnv(t);
  for (const [status, message] of [[403, ERROR_MESSAGES.editLockForbidden], [404, ERROR_MESSAGES.editLockMissing]]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(
      { error: { message: "internal owner_id mismatch at DocumentEditLockService" } },
      { status }
    ));
    await assert.rejects(acquireEditLock(DOCUMENT_ID), (error) => {
      assert.equal(error.message, message);
      return true;
    });
    t.mock.restoreAll();
  }
});

test("heartbeat는 POST로 잠금을 연장하고 409면 EditLockLostError를 던진다", async (t) => {
  workspaceEnv(t);
  const calls = [];
  let lost = false;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method]);
    return lost
      ? Response.json({ error: { message: "lock expired" } }, { status: 409 })
      : Response.json({ expires_at: "2026-10-04T00:02:00Z" });
  });

  assert.equal((await sendEditLockHeartbeat(DOCUMENT_ID)).expires_at, "2026-10-04T00:02:00Z");
  lost = true;
  await assert.rejects(sendEditLockHeartbeat(DOCUMENT_ID), EditLockLostError);
  assert.deepEqual(calls, [
    [`${LOCK_PATH}/heartbeat`, "POST"],
    [`${LOCK_PATH}/heartbeat`, "POST"]
  ]);
});

test("편집기 종료 시 잠금을 DELETE로 해제하고 204를 성공으로 처리한다", async (t) => {
  workspaceEnv(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method]);
    return new Response(null, { status: 204 });
  });

  await releaseEditLock(DOCUMENT_ID);

  assert.deepEqual(calls, [[LOCK_PATH, "DELETE"]]);
});

test("heartbeat 주기는 만료까지 남은 시간의 1/3이며 상·하한으로 묶는다", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  const after = (seconds) => new Date(now + seconds * 1000).toISOString();

  assert.equal(resolveHeartbeatDelayMs(after(90), now), 30_000);
  // 하한: 만료가 임박해도 초당 요청으로 번지지 않게 한다.
  assert.equal(resolveHeartbeatDelayMs(after(3), now), HEARTBEAT_MIN_MS);
  assert.equal(resolveHeartbeatDelayMs(after(-10), now), HEARTBEAT_MIN_MS);
  // 상한: TTL이 아주 길어도 잠금 상실을 늦게 알아차리지 않게 한다.
  assert.equal(resolveHeartbeatDelayMs(after(3600), now), HEARTBEAT_MAX_MS);
  // 만료 시각이 없거나 깨져 있으면 추측 대신 보수적인 고정 주기를 쓴다.
  assert.equal(resolveHeartbeatDelayMs(undefined, now), HEARTBEAT_FALLBACK_MS);
  assert.equal(resolveHeartbeatDelayMs("만료시각아님", now), HEARTBEAT_FALLBACK_MS);
});

test("heartbeat 409로 잠금을 잃으면 autosave가 더 이상 서버에 쓰지 않는다", async (t) => {
  workspaceEnv(t);
  let saves = 0;
  t.mock.method(globalThis, "fetch", async () => {
    saves++;
    return Response.json({
      document_id: DOCUMENT_ID,
      current_version: 8,
      updated_at: "2026-10-04T00:00:00Z"
    });
  });

  const { result: autosave } = render(() => useNoteAutosave({
    documentId: DOCUMENT_ID,
    marker: "<!-- note -->",
    initialVersion: 7
  }));

  assert.equal(await autosave.saveNow("잠금 보유 중 편집"), true);
  assert.equal(saves, 1);

  // useEditLock이 heartbeat 409를 받으면 호출하는 지점이다.
  autosave.reportSaveBlock("lock-lost", ERROR_MESSAGES.editLockLost);

  assert.equal(await autosave.saveNow("잠금 상실 후 편집"), false);
  autosave.queueSave("잠금 상실 후 디바운스 편집");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(saves, 1, "잠금을 잃은 뒤에는 저장 요청을 보내지 않는다");
});
