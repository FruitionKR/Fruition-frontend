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
const { resolveHeartbeatFailure } = await import("../src/features/note-editing/model/editLockSchedule.ts");
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

test("heartbeat 실패는 로그인 필요거나 연속 한도를 넘으면 더 재시도하지 않는다", () => {
  const loginRequired = new SessionExpiredError(ERROR_MESSAGES.loginRequired);
  const network = new Error("Failed to fetch");

  // 세션 만료는 기다려도 회복되지 않으므로 즉시 종료로 본다.
  assert.equal(resolveHeartbeatFailure(loginRequired, 1), "terminal");
  // 일시적인 네트워크 오류는 한도 안에서는 재시도한다.
  assert.equal(resolveHeartbeatFailure(network, 1), "retry");
  assert.equal(resolveHeartbeatFailure(network, 2), "retry");
  // 한도를 넘으면 잠금을 쥐고 있다고 주장하지 않는다.
  assert.equal(resolveHeartbeatFailure(network, 3), "terminal");
  assert.equal(resolveHeartbeatFailure(network, 9), "terminal");
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
