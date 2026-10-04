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

const { ERROR_MESSAGES, apiFetch } = await import("../src/shared/api/client.ts");
const { saveAccessToken, setSessionExpiredHandler } = await import("../src/shared/lib/auth.ts");
const { useNoteAutosave } = await import("../src/features/note-editing/model/useNoteAutosave.ts");
const { HEARTBEAT_RETRY_MS } = await import("../src/features/note-editing/model/editLockSchedule.ts");
const { useEditLock } = await import("../src/features/note-editing/model/useEditLock.ts");
const { SessionExpiredError } = await import("../src/shared/lib/errors.ts");
const { render } = await import("./reactHookShim.mjs");

const DOCUMENT_ID = "doc_session_expiry";

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
    setSessionExpiredHandler(null);
  });
  saveAccessToken("test-access");
}

test("재발급까지 실패하면 세션 만료를 중앙 처리기에 알리고 로그인 필요 에러를 던진다", async (t) => {
  workspaceEnv(t);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  let notified = 0;
  setSessionExpiredHandler(() => {
    notified++;
  });

  await assert.rejects(apiFetch("/api/workspaces/ws_test/documents"), (error) => {
    assert.equal(error.message, ERROR_MESSAGES.loginRequired);
    return true;
  });

  assert.equal(notified, 1, "세션이 만료되면 재인증 처리기가 정확히 한 번 호출된다");
});

test("정상 응답에서는 세션 만료를 알리지 않는다", async (t) => {
  workspaceEnv(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true }));
  let notified = 0;
  setSessionExpiredHandler(() => {
    notified++;
  });

  await apiFetch("/api/workspaces/ws_test/documents");

  assert.equal(notified, 0);
});

test("세션이 만료되면 autosave가 저장을 멈추고 더 이상 서버에 쓰지 않는다", async (t) => {
  workspaceEnv(t);
  let saves = 0;
  // 저장 요청은 401만 돌려주고 refresh도 실패해 apiFetch가 loginRequired를 던지는 상황이다.
  t.mock.method(globalThis, "fetch", async (path) => {
    if (path === "/api/auth/refresh") return new Response(null, { status: 401 });
    saves++;
    return new Response(null, { status: 401 });
  });

  const { result: autosave } = render(() => useNoteAutosave({
    documentId: DOCUMENT_ID,
    marker: "<!-- note -->",
    initialVersion: 7
  }));

  assert.equal(await autosave.saveNow("세션 만료 중 편집"), false);
  const savesAfterBlock = saves;

  assert.equal(await autosave.saveNow("세션 만료 후 편집"), false);
  autosave.queueSave("세션 만료 후 디바운스 편집");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(saves, savesAfterBlock, "세션이 만료된 뒤에는 저장 요청을 보내지 않는다");
});

/** mock timer를 진행시킨 뒤 heartbeat의 비동기 후속 작업이 끝날 틈을 준다. */
async function advance(t, ms) {
  t.mock.timers.tick(ms);
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

/** 잠금은 300초 TTL로 받고, heartbeat는 언제나 401이며 refresh 응답만 바꿔 끼운다. */
function heartbeatEnv(t, refreshResponse) {
  workspaceEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let heartbeats = 0;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path === "/api/auth/refresh") return refreshResponse();
    if (path.endsWith("/heartbeat")) {
      heartbeats++;
      return new Response(null, { status: 401 });
    }
    if (init?.method === "POST") return Response.json({ expires_at: new Date(Date.now() + 300_000).toISOString() });
    return new Response(null, { status: 204 });
  });
  const lost = [];
  render(() => useEditLock({ documentId: DOCUMENT_ID, onLockLost: (message) => lost.push(message) }));
  return { lost, heartbeats: () => heartbeats };
}

test("refresh가 거절된 heartbeat는 만료 시각이 남아 있어도 즉시 잠금을 끝낸다", async (t) => {
  const { lost, heartbeats } = heartbeatEnv(t, () => new Response(null, { status: 401 }));
  await advance(t, 0);

  // 첫 heartbeat(100초) 뒤 재시도 간격을 여러 번 지나도 다시 두드리지 않는다.
  for (let elapsed = 0; elapsed < 130_000; elapsed += HEARTBEAT_RETRY_MS) await advance(t, HEARTBEAT_RETRY_MS);

  assert.equal(lost.length, 1, "세션 만료는 기다려도 회복되지 않으므로 바로 끝낸다");
  assert.equal(heartbeats(), 1);
});

test("refresh가 502로 실패한 heartbeat는 세션 만료로 보지 않고 만료 전까지 재시도한다", async (t) => {
  const { lost, heartbeats } = heartbeatEnv(t, () => new Response(null, { status: 502 }));
  await advance(t, 0);

  for (let elapsed = 0; elapsed < 130_000; elapsed += HEARTBEAT_RETRY_MS) await advance(t, HEARTBEAT_RETRY_MS);

  assert.deepEqual(lost, [], "일시적인 refresh 실패로 편집기를 닫지 않는다");
  assert.ok(heartbeats() > 1, `만료 전까지 계속 두드린다 (heartbeats=${heartbeats()})`);
});

test("재발급이 성공하면 이어지는 401은 세션 만료가 아니라 요청 거절로 다룬다", async (t) => {
  workspaceEnv(t);
  // 현재 비밀번호를 틀린 상황: 본문이 비어 있고 code도 없는 401이 온다.
  t.mock.method(globalThis, "fetch", async (path) => {
    if (path === "/api/auth/refresh") return Response.json({ access_token: "fresh" });
    return new Response(null, { status: 401 });
  });
  let notified = 0;
  setSessionExpiredHandler(() => {
    notified++;
  });

  const response = await apiFetch("/api/auth/me/password", { method: "PUT" });

  assert.equal(response.status, 401, "호출부가 응답을 읽어 입력 오류를 안내할 수 있다");
  assert.equal(notified, 0, "비밀번호 확인 실패로 로그아웃시키지 않는다");
});

test("재발급 대상이 아닌 인증 요청의 401은 응답을 그대로 돌려준다", async (t) => {
  workspaceEnv(t);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  let notified = 0;
  setSessionExpiredHandler(() => {
    notified++;
  });

  const response = await apiFetch("/api/auth/login", { method: "POST" });

  assert.equal(response.status, 401);
  assert.equal(notified, 0);
});

test("세션 만료는 문구가 아니라 타입으로 구분된다", async (t) => {
  workspaceEnv(t);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  setSessionExpiredHandler(() => {});

  await assert.rejects(apiFetch("/api/workspaces/ws_test/documents"), (error) => {
    assert.ok(error instanceof SessionExpiredError);
    return true;
  });
});

test("동시에 터진 401들은 세션 만료 처리기를 한 번만 호출한다", async (t) => {
  workspaceEnv(t);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  let notified = 0;
  setSessionExpiredHandler(() => {
    notified++;
  });

  const results = await Promise.allSettled([
    apiFetch("/api/workspaces/ws_test/documents"),
    apiFetch("/api/workspaces/ws_test/folders"),
    apiFetch("/api/workspaces/ws_test/wiki/graph")
  ]);

  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(notified, 1, "로그아웃·캐시 비우기·라우팅을 요청 수만큼 반복하지 않는다");
});

test("다시 로그인하면 래치가 풀려 다음 만료도 알린다", async (t) => {
  workspaceEnv(t);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  let notified = 0;
  setSessionExpiredHandler(() => {
    notified++;
  });

  await assert.rejects(apiFetch("/api/workspaces/ws_test/documents"));
  assert.equal(notified, 1);

  // 로그인 성공으로 새 access token을 받은 뒤의 만료는 다시 알려야 한다.
  saveAccessToken("new-access");
  await assert.rejects(apiFetch("/api/workspaces/ws_test/documents"));
  assert.equal(notified, 2);
});

/** 저장 성공 응답. 서버는 current_version을 하나 올려 돌려준다. */
const savedResponse = (version) => Response.json({ document_id: DOCUMENT_ID, current_version: version, attachments: [] });

const TRANSIENT_REFRESH_FAILURES = {
  "502 응답": () => new Response(null, { status: 502 }),
  "access_token 없는 200 응답": () => Response.json({}),
  "네트워크 오류": () => { throw new TypeError("Failed to fetch"); }
};

for (const [label, refresh] of Object.entries(TRANSIENT_REFRESH_FAILURES)) {
  test(`refresh가 일시적으로 실패하면(${label}) 세션 만료로 보지 않는다`, async (t) => {
    workspaceEnv(t);
    t.mock.method(globalThis, "fetch", async (path) => {
      if (path === "/api/auth/refresh") return refresh();
      return new Response(null, { status: 401 });
    });
    let notified = 0;
    setSessionExpiredHandler(() => {
      notified++;
    });

    await assert.rejects(apiFetch("/api/workspaces/ws_test/documents"), (error) => {
      assert.ok(!(error instanceof SessionExpiredError), "재시도할 수 있는 실패다");
      return true;
    });
    assert.equal(notified, 0, "일시적인 실패로 재로그인을 안내하지 않는다");
  });
}

test("refresh가 502로 한 번 실패해도 autosave는 멈추지 않고 이후 편집을 저장한다", async (t) => {
  workspaceEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let refreshFails = true;
  const sent = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path === "/api/auth/refresh") {
      if (refreshFails) return new Response(null, { status: 502 });
      return Response.json({ access_token: "fresh" });
    }
    const authorization = new Headers(init?.headers).get("Authorization");
    if (authorization !== "Bearer fresh") return new Response(null, { status: 401 });
    sent.push(await init.body.get("markdown").text());
    return savedResponse(8 + sent.length - 1);
  });

  const { result: autosave } = render(() => useNoteAutosave({
    documentId: DOCUMENT_ID,
    marker: "<!-- note -->",
    initialVersion: 7
  }));

  assert.equal(await autosave.saveNow("터널 안에서 쓴 문장"), false, "refresh가 502면 이번 저장은 실패한다");

  // 연결이 돌아온 뒤의 즉시 저장과 디바운스 저장이 모두 서버에 도달해야 한다.
  refreshFails = false;
  assert.equal(await autosave.saveNow("터널 안에서 쓴 문장"), true);
  autosave.queueSave("터널을 나와 이어 쓴 문장");
  t.mock.timers.tick(1_000);
  for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 2, "일시적인 실패 뒤의 편집이 버려지지 않는다");
  assert.match(sent[0], /터널 안에서 쓴 문장/);
  assert.match(sent[1], /터널을 나와 이어 쓴 문장/);
});

test("세션 만료로 멈춘 autosave는 다시 인증되면 저장을 재개한다", async (t) => {
  workspaceEnv(t);
  let expired = true;
  const sent = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path === "/api/auth/refresh") return new Response(null, { status: 401 });
    if (expired) return new Response(null, { status: 401 });
    sent.push(await init.body.get("markdown").text());
    return savedResponse(8);
  });

  const { result: autosave } = render(() => useNoteAutosave({
    documentId: DOCUMENT_ID,
    marker: "<!-- note -->",
    initialVersion: 7
  }));

  assert.equal(await autosave.saveNow("만료 중 편집"), false);

  // 다른 경로(다른 탭의 로그인, 다른 요청의 재발급)로 새 access token을 받았다.
  expired = false;
  saveAccessToken("relogin-access");

  assert.equal(await autosave.saveNow("재인증 후 편집"), true, "세션이 돌아오면 저장 차단이 풀린다");
  assert.equal(sent.length, 1);
  assert.match(sent[0], /재인증 후 편집/);
});

test("일시적인 refresh 실패 뒤 실제로 세션이 만료되면 그때 정확히 한 번 알린다", async (t) => {
  workspaceEnv(t);
  let refreshStatus = 502;
  t.mock.method(globalThis, "fetch", async (path) => {
    if (path === "/api/auth/refresh") return new Response(null, { status: refreshStatus });
    return new Response(null, { status: 401 });
  });
  let notified = 0;
  setSessionExpiredHandler(() => {
    notified++;
  });

  await assert.rejects(apiFetch("/api/workspaces/ws_test/documents"));
  assert.equal(notified, 0, "일시적인 실패는 알리지 않는다");

  refreshStatus = 401;
  await assert.rejects(apiFetch("/api/workspaces/ws_test/documents"), (error) => error instanceof SessionExpiredError);
  await assert.rejects(apiFetch("/api/workspaces/ws_test/folders"), (error) => error instanceof SessionExpiredError);
  assert.equal(notified, 1, "실제 만료는 한 번만 알린다");
});

test("재발급이 성공해도 재시도가 다시 401이면 세션 만료로 다룬다", async (t) => {
  workspaceEnv(t);
  t.mock.method(globalThis, "fetch", async (path) => {
    if (path === "/api/auth/refresh") return Response.json({ access_token: "fresh" });
    return new Response(null, { status: 401 });
  });
  let notified = 0;
  setSessionExpiredHandler(() => {
    notified++;
  });

  await assert.rejects(apiFetch("/api/workspaces/ws_test/documents"), (error) => error instanceof SessionExpiredError);
  assert.equal(notified, 1);
});

test("세션 만료 중 잠금을 잃었으면 세션이 돌아와도 저장을 재개하지 않는다", async (t) => {
  workspaceEnv(t);
  let saves = 0;
  t.mock.method(globalThis, "fetch", async (path) => {
    if (path === "/api/auth/refresh") return new Response(null, { status: 401 });
    saves++;
    return new Response(null, { status: 401 });
  });

  const { result: autosave } = render(() => useNoteAutosave({
    documentId: DOCUMENT_ID,
    marker: "<!-- note -->",
    initialVersion: 7
  }));

  assert.equal(await autosave.saveNow("만료 중 편집"), false);
  autosave.reportSaveBlock("lock-lost", ERROR_MESSAGES.editLockLost);
  saveAccessToken("relogin-access");
  const savesBefore = saves;

  assert.equal(await autosave.saveNow("잠금을 잃은 뒤 편집"), false, "잠금 상실은 세션 회복으로 풀리지 않는다");
  assert.equal(saves, savesBefore);
});
