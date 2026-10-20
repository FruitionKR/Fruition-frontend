import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });

const { checkStorageQuota, describeLimitError, isFreeWorkspaceLimitReached } = await import("../src/entities/workspace/model/workspaceLimits.ts");
const { ApiError } = await import("../src/shared/lib/apiErrors.ts");

const MB = 1024 * 1024;
const GB = 1024 * MB;
const freeStorage = (usedBytes) => ({ plan: "FREE", used_bytes: usedBytes, limit_bytes: 1 * GB });

test("파일 하나의 크기는 막지 않고 남은 용량만 본다", () => {
  assert.deepEqual(checkStorageQuota([900 * MB], freeStorage(0)), [null]);
});

test("한 번에 올린 파일들이 남은 용량을 나눠 쓰고, 넘치는 파일만 막는다", () => {
  const result = checkStorageQuota([40 * MB, 40 * MB, 10 * MB], freeStorage(1 * GB - 60 * MB));
  assert.equal(result[0], null);
  assert.match(result[1], /저장 공간이 부족합니다/);
  assert.equal(result[2], null);
});

test("용량·개수 제한 에러 code만 정해 둔 문구로 바꾼다", () => {
  assert.match(describeLimitError(new ApiError("server", 413, "STORAGE_QUOTA_EXCEEDED")), /저장 공간이 부족합니다/);
  assert.match(describeLimitError(new ApiError("server", 409, "WORKSPACE_LIMIT_EXCEEDED")), /무료 워크스페이스/);
  assert.equal(describeLimitError(new ApiError("server", 409, "OTHER")), null);
  assert.equal(describeLimitError(new Error("plain")), null);
});

test("무료 워크스페이스 한도는 서버가 값을 줄 때만 적용한다", () => {
  assert.equal(isFreeWorkspaceLimitReached(3, 3), true);
  assert.equal(isFreeWorkspaceLimitReached(2, 3), false);
  assert.equal(isFreeWorkspaceLimitReached(5, null), false);
  assert.equal(isFreeWorkspaceLimitReached(undefined, undefined), false);
});

test("용량 API가 404면 null을 돌려주고 같은 워크스페이스는 다시 요청하지 않는다", async (t) => {
  const { fetchWorkspaceStorage } = await import("../src/entities/workspace/api/workspace.ts");
  const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
  const old = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  t.after(() => { if (old === undefined) delete globalThis.window; else globalThis.window = old; });
  saveAccessToken("access-test");
  const paths = [];
  t.mock.method(globalThis, "fetch", async (path) => {
    paths.push(String(path));
    return String(path).includes("ws_missing")
      ? new Response(null, { status: 404 })
      : Response.json({ plan: "FREE", used_bytes: 1, limit_bytes: 2 });
  });
  assert.equal(await fetchWorkspaceStorage("ws_missing"), null);
  assert.equal(await fetchWorkspaceStorage("ws_missing"), null);
  assert.equal(paths.filter((path) => path.includes("ws_missing")).length, 1);
  // 다른 워크스페이스는 따로 묻는다.
  assert.deepEqual(await fetchWorkspaceStorage("ws_ok"), { plan: "FREE", used_bytes: 1, limit_bytes: 2 });
  assert.deepEqual(await fetchWorkspaceStorage("ws_ok"), { plan: "FREE", used_bytes: 1, limit_bytes: 2 });
  assert.equal(paths.filter((path) => path.includes("ws_ok")).length, 2);
});
