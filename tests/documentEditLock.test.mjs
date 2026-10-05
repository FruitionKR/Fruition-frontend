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
  EditLockDeniedError,
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
  HEARTBEAT_RETRY_MS,
  describeEditLockHolder,
  resolveHeartbeatDelayMs,
  resolveHeartbeatFailure,
  resolveLockRemainingMs
} = await import("../src/features/note-editing/model/editLockSchedule.ts");
const { useEditLock } = await import("../src/features/note-editing/model/useEditLock.ts");
const { SessionExpiredError } = await import("../src/shared/lib/errors.ts");
const { useNoteAutosave } = await import("../src/features/note-editing/model/useNoteAutosave.ts");
const { ERROR_MESSAGES } = await import("../src/shared/api/client.ts");
const { saveAccessToken } = await import("../src/shared/lib/auth.ts");
const { render } = await import("./reactHookShim.mjs");

const DOCUMENT_ID = "doc_edit_lock";
const LOCK_PATH = `/api/workspaces/ws_test/documents/${DOCUMENT_ID}/edit-lock`;

/** 편집 잠금 API는 선택된 워크스페이스와 access token을 쓴다. */
function workspaceEnv(t) {
  const original = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key) => (key === "fruition.workspace_id" ? "ws_test" : null),
      setItem() {},
      removeItem() {}
    }
  });
  // 탭 복귀(visibilitychange)를 흉내 내려고 visibilityState를 바꿀 수 있는 document를 둔다.
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  t.after(() => {
    globalThis.window = original;
    globalThis.document = originalDocument;
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
  await assert.rejects(sendEditLockHeartbeat(DOCUMENT_ID), (error) => {
    assert.ok(error instanceof EditLockLostError);
    // 409는 대부분 만료다. 혼자 쓰는 문서에서 다른 사용자를 탓하지 않는다.
    assert.equal(error.message, ERROR_MESSAGES.editLockExpired);
    assert.doesNotMatch(error.message, /다른 사용자/);
    return true;
  });
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

test("heartbeat 실패 처리는 실패 횟수가 아니라 서버 만료 시각으로 끝낸다", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  const network = new Error("Failed to fetch");

  // 만료 전이라면 서버 잠금은 아직 우리 것이다. 몇 번을 실패해도 편집기를 닫지 않는다.
  assert.equal(resolveHeartbeatFailure(network, now + 60_000, now), "retry");
  // 만료 후에는 보유를 주장하지 않고 재획득으로 사실을 확인한다.
  assert.equal(resolveHeartbeatFailure(network, now - 1, now), "reacquire");
  assert.equal(resolveHeartbeatFailure(network, null, now), "reacquire");
  // 세션 만료는 기다려도 회복되지 않는다.
  assert.equal(resolveHeartbeatFailure(new SessionExpiredError("로그인이 필요합니다."), now + 60_000, now), "terminal");
});

const TEN_MINUTES_MS = 10 * 60_000;

/** 응답을 받은 순간의 단조 시계에 남은 시간을 더한 로컬 마감 시각. useEditLock과 같은 계산이다. */
function localDeadline(lock, monotonicNowMs, wallNowMs) {
  const remaining = resolveLockRemainingMs(lock, wallNowMs);
  return remaining === null ? null : monotonicNowMs + remaining;
}

test("클라이언트 시계가 서버보다 느려도 서버 TTL이 지나면 heartbeat 실패 시 재획득한다", () => {
  const serverNow = Date.parse("2026-10-04T00:10:00Z");
  const network = new Error("Failed to fetch");
  const lock = { expires_at: new Date(serverNow + 30_000).toISOString(), ttl_ms: 30_000 };

  // 응답 시점 단조 시계 1초, 클라이언트 벽시계는 서버보다 10분 느리다.
  const deadline = localDeadline(lock, 1_000, serverNow - TEN_MINUTES_MS);

  // 서버 TTL(30초)이 지난 뒤의 실패는 만료로 보고 재획득으로 확인한다.
  assert.equal(resolveHeartbeatFailure(network, deadline, 1_000 + 30_001), "reacquire");
  assert.equal(resolveHeartbeatFailure(network, deadline, 1_000 + 29_000), "retry");
});

test("클라이언트 시계가 서버보다 빨라도 서버 TTL이 남아 있으면 heartbeat 실패 시 재시도한다", () => {
  const serverNow = Date.parse("2026-10-04T00:10:00Z");
  const network = new Error("Failed to fetch");
  const lock = { expires_at: new Date(serverNow + 30_000).toISOString(), ttl_ms: 30_000 };

  const deadline = localDeadline(lock, 1_000, serverNow + TEN_MINUTES_MS);

  assert.equal(resolveHeartbeatFailure(network, deadline, 1_000 + 10_000), "retry");
  // 주기도 시계 차이와 무관하게 TTL의 1/3이다.
  assert.equal(resolveHeartbeatDelayMs(lock.expires_at, serverNow + TEN_MINUTES_MS, lock.ttl_ms), 10_000);
});

test("ttl_ms가 없는 구버전 응답은 expires_at과 클라이언트 시계로 판단한다", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  const network = new Error("Failed to fetch");
  const lock = { expires_at: new Date(now + 30_000).toISOString() };

  assert.equal(resolveLockRemainingMs(lock, now), 30_000);
  const deadline = localDeadline(lock, 1_000, now);
  assert.equal(resolveHeartbeatFailure(network, deadline, 1_000 + 29_000), "retry");
  assert.equal(resolveHeartbeatFailure(network, deadline, 1_000 + 30_000), "reacquire");
  assert.equal(resolveHeartbeatDelayMs(lock.expires_at, now, undefined), 10_000);
  // 만료 시각도 TTL도 없으면 기존처럼 판단 근거가 없다.
  assert.equal(resolveLockRemainingMs({}, now), null);
});

/** mock timer를 진행시킨 뒤 heartbeat의 비동기 후속 작업이 끝날 틈을 준다. */
async function advance(t, ms) {
  t.mock.timers.tick(ms);
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

function lockEnv(t, { expiresInMs, onHeartbeat, onAcquire }) {
  workspaceEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  // 단조 시계도 mock 시간을 따르게 한다. 벽시계와 어긋나는 상황은 응답의 expires_at으로 흉내 낸다.
  t.mock.method(performance, "now", () => Date.now());
  const acquires = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path.endsWith("/heartbeat")) return onHeartbeat();
    if (init?.method === "POST") {
      acquires.push(Date.now());
      return onAcquire
        ? onAcquire()
        : Response.json({ expires_at: new Date(Date.now() + expiresInMs).toISOString() });
    }
    return new Response(null, { status: 204 });
  });
  const lost = [];
  const view = render(() => useEditLock({ documentId: DOCUMENT_ID, onLockLost: (message) => lost.push(message) }));
  return { acquires, lost, view };
}

test("만료 전의 연속 네트워크 오류는 편집기를 끝내지 않고 계속 재시도한다", async (t) => {
  // 서버 TTL 300초. 30초짜리 터널에서 편집기가 죽지 않아야 한다.
  const { lost, acquires } = lockEnv(t, {
    expiresInMs: 300_000,
    onHeartbeat: () => { throw new Error("Failed to fetch"); }
  });
  await advance(t, 0);

  // 첫 heartbeat(100초) 이후 5초 간격 재시도를 180초 동안 반복한다.
  for (let elapsed = 0; elapsed < 180_000; elapsed += HEARTBEAT_RETRY_MS) await advance(t, HEARTBEAT_RETRY_MS);

  assert.deepEqual(lost, [], "만료 전에는 잠금 상실로 보지 않는다");
  assert.equal(acquires.length, 1, "만료 전에는 재획득하지 않는다");
});

test("만료 후 연결이 돌아오면 잠금을 다시 받아 편집을 이어간다", async (t) => {
  let failHeartbeat = true;
  const { lost, acquires, view } = lockEnv(t, {
    expiresInMs: 30_000,
    onHeartbeat: () => {
      if (failHeartbeat) throw new Error("Failed to fetch");
      return Response.json({ expires_at: new Date(Date.now() + 30_000).toISOString() });
    }
  });
  await advance(t, 0);

  // 만료(30초)를 지나도록 heartbeat를 계속 실패시킨다.
  for (let elapsed = 0; elapsed < 60_000; elapsed += HEARTBEAT_RETRY_MS) await advance(t, HEARTBEAT_RETRY_MS);

  assert.deepEqual(lost, [], "아무도 가져가지 않았다면 편집기는 그대로 살아난다");
  assert.ok(acquires.length >= 2, `만료 후에는 재획득을 시도한다 (acquires=${acquires.length})`);
  assert.equal(view.rerender().phase, "granted");
});

test("만료 후 다른 사용자가 잠금을 가져갔으면 재획득 실패로 끝낸다", async (t) => {
  const { lost } = lockEnv(t, {
    expiresInMs: 30_000,
    onHeartbeat: () => { throw new Error("Failed to fetch"); },
    onAcquire: (() => {
      let first = true;
      return () => {
        if (first) {
          first = false;
          return Response.json({ expires_at: new Date(Date.now() + 30_000).toISOString() });
        }
        return Response.json({ holder_display_name: "다른 사용자" }, { status: 423 });
      };
    })()
  });
  await advance(t, 0);

  for (let elapsed = 0; elapsed < 60_000; elapsed += HEARTBEAT_RETRY_MS) await advance(t, HEARTBEAT_RETRY_MS);

  assert.equal(lost.length, 1, "다른 사용자가 보유 중이면 저장을 멈춘다");
  assert.match(lost[0], /다른 사용자/);
});

test("서버 시계가 10분 앞서도 ttl_ms가 지나면 재시도를 멈추고 재획득한다", async (t) => {
  // 서버 시계 = 클라이언트 + 10분. expires_at만 보면 10분 넘게 만료 전으로 보인다.
  const serverLock = () => Response.json({
    expires_at: new Date(Date.now() + TEN_MINUTES_MS + 30_000).toISOString(),
    ttl_ms: 30_000
  });
  const { lost, acquires } = lockEnv(t, {
    onHeartbeat: () => { throw new Error("Failed to fetch"); },
    onAcquire: serverLock
  });
  await advance(t, 0);

  for (let elapsed = 0; elapsed < 60_000; elapsed += HEARTBEAT_RETRY_MS) await advance(t, HEARTBEAT_RETRY_MS);

  assert.ok(acquires.length >= 2, `서버 TTL이 지나면 재획득으로 사실을 확인한다 (acquires=${acquires.length})`);
  assert.deepEqual(lost, []);
});

test("잠글 수 없는 문서(403·404)는 네트워크 오류와 구분된다", async (t) => {
  workspaceEnv(t);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 403 }));
  await assert.rejects(acquireEditLock(DOCUMENT_ID), (error) => {
    assert.ok(error instanceof EditLockDeniedError);
    assert.equal(error.message, ERROR_MESSAGES.editLockForbidden);
    return true;
  });
});

/** 첫 heartbeat는 409, 재획득은 onReacquire 응답. 혼자 쓰는 문서에서 heartbeat가 늦어 만료된 상황이다. */
function expiredHeartbeatEnv(t, onReacquire) {
  let heartbeats = 0;
  let acquireCount = 0;
  const env = lockEnv(t, {
    expiresInMs: 30_000,
    onHeartbeat: () => {
      heartbeats++;
      return heartbeats === 1
        ? Response.json({ error: { message: "lock expired" } }, { status: 409 })
        : Response.json({ expires_at: new Date(Date.now() + 30_000).toISOString() });
    },
    onAcquire: () => {
      acquireCount++;
      return acquireCount === 1
        ? Response.json({ expires_at: new Date(Date.now() + 30_000).toISOString() })
        : onReacquire();
    }
  });
  return { ...env, heartbeats: () => heartbeats };
}

test("heartbeat 409라도 재획득이 되면 잠금을 잃지 않고 heartbeat를 이어간다", async (t) => {
  const { lost, acquires, view, heartbeats } = expiredHeartbeatEnv(t, () => Response.json({
    expires_at: new Date(Date.now() + 30_000).toISOString()
  }));
  await advance(t, 0);

  // 첫 heartbeat(10초)가 409를 받는다.
  await advance(t, 10_000);

  assert.deepEqual(lost, [], "만료됐어도 아무도 가져가지 않았으면 저장을 멈추지 않는다");
  assert.equal(acquires.length, 2, "409를 받으면 재획득으로 사실을 확인한다");
  assert.equal(view.rerender().phase, "granted");

  await advance(t, 10_000);
  assert.equal(heartbeats(), 2, "재획득한 잠금도 계속 연장한다");
});

test("heartbeat 409 후 재획득이 423이면 보유자 이름으로 잠금 상실을 알린다", async (t) => {
  const { lost, view } = expiredHeartbeatEnv(t, () => Response.json(
    { holder_display_name: "테스트사용자", holder_user_id: "user_other" },
    { status: 423 }
  ));
  await advance(t, 0);
  await advance(t, 10_000);

  assert.deepEqual(lost, ["테스트사용자님이 편집 중입니다."]);
  assert.equal(view.rerender().phase, "lost");
});

test("heartbeat 409 후 보유자 이름 없는 423이면 다른 사용자 문구로 알린다", async (t) => {
  const { lost } = expiredHeartbeatEnv(t, () => Response.json({}, { status: 423 }));
  await advance(t, 0);
  await advance(t, 10_000);

  assert.deepEqual(lost, [ERROR_MESSAGES.editLockLost]);
});

test("heartbeat 409 후 재획득이 403이면 권한 문구로 잠금을 잃는다", async (t) => {
  const { lost } = expiredHeartbeatEnv(t, () => new Response(null, { status: 403 }));
  await advance(t, 0);
  await advance(t, 10_000);

  assert.deepEqual(lost, [ERROR_MESSAGES.editLockForbidden]);
});

test("heartbeat 409 후 재획득도 일시 오류면 만료 문구로 잠금을 잃는다", async (t) => {
  const { lost, view } = expiredHeartbeatEnv(t, () => { throw new Error("Failed to fetch"); });
  await advance(t, 0);
  await advance(t, 10_000);

  // 서버가 이미 만료시킨 잠금이라 보유를 주장하지 않는다. 다만 다른 사용자를 탓하지 않는다.
  assert.deepEqual(lost, [ERROR_MESSAGES.editLockExpired]);
  assert.equal(view.rerender().phase, "lost");
});

test("탭이 다시 보이거나 온라인이 되면 예약을 기다리지 않고 heartbeat를 보낸다", async (t) => {
  let heartbeats = 0;
  let release = null;
  const { lost, view } = lockEnv(t, {
    expiresInMs: 30_000,
    onHeartbeat: () => {
      heartbeats++;
      return new Promise((resolve) => {
        release = () => resolve(Response.json({ expires_at: new Date(Date.now() + 30_000).toISOString() }));
      });
    }
  });
  await advance(t, 0);

  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  await advance(t, 0);
  assert.equal(heartbeats, 0, "숨겨질 때는 보내지 않는다");

  document.visibilityState = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  await advance(t, 0);
  assert.equal(heartbeats, 1, "다시 보이면 즉시 보낸다");

  // 응답을 기다리는 중에는 겹쳐 보내지 않는다.
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("online"));
  await advance(t, 0);
  assert.equal(heartbeats, 1, "진행 중인 heartbeat가 있으면 중복 요청하지 않는다");

  release();
  await advance(t, 0);
  window.dispatchEvent(new Event("online"));
  await advance(t, 0);
  assert.equal(heartbeats, 2, "온라인 복귀에도 즉시 보낸다");
  release();
  await advance(t, 0);

  // 즉시 보낸 뒤에는 원래 예약이 취소돼 같은 주기에 두 번 보내지 않는다.
  await advance(t, 9_999);
  assert.equal(heartbeats, 2);
  await advance(t, 1);
  assert.equal(heartbeats, 3);
  release();
  await advance(t, 0);

  view.unmount();
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("online"));
  await advance(t, 0);
  assert.equal(heartbeats, 3, "편집기를 떠나면 리스너를 지운다");
  assert.deepEqual(lost, []);
});

test("편집기를 떠나면 탭 복귀·온라인 리스너를 해제한다", async (t) => {
  const { view } = lockEnv(t, { expiresInMs: 30_000 });
  // disposed 가드가 있어 이벤트를 쏴 보는 것만으로는 해제 누락이 드러나지 않는다. 등록 수를 직접 센다.
  const active = { visibilitychange: new Set(), online: new Set() };
  for (const target of [document, window]) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, listener, options) => { active[type]?.add(listener); add(type, listener, options); };
    target.removeEventListener = (type, listener, options) => { active[type]?.delete(listener); remove(type, listener, options); };
  }
  view.unmount();
  const remounted = render(() => useEditLock({ documentId: DOCUMENT_ID, onLockLost() {} }));
  await advance(t, 0);
  assert.equal(active.visibilitychange.size, 1);
  assert.equal(active.online.size, 1);

  remounted.unmount();
  assert.equal(active.visibilitychange.size, 0, "visibilitychange 리스너가 남으면 떠난 편집기가 계속 이벤트를 받는다");
  assert.equal(active.online.size, 0, "online 리스너가 남으면 떠난 편집기가 계속 이벤트를 받는다");
});
