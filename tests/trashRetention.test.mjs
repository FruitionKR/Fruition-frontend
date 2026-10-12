import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const {
  TRASH_RETENTION_EXPIRED_MESSAGE,
  WORKSPACE_TRASH_EXPIRED_MESSAGE,
  daysUntilPurge,
  describePurge,
  describeRestoreError,
  isRetentionExpired
} = await import("../src/entities/document/lib/trashRetention.ts");
const { restoreTrashDocument } = await import("../src/entities/document/api/trash.ts");
const { ApiError } = await import("../src/shared/lib/errors.ts");
const { saveAccessToken } = await import("../src/shared/lib/auth.ts");

const NOW = Date.parse("2026-10-12T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

test("영구 삭제까지 남은 일수는 올림이고, 지났으면 0, 모르면 null이다", () => {
  assert.equal(daysUntilPurge(new Date(NOW + 27 * DAY).toISOString(), NOW), 27);
  assert.equal(daysUntilPurge(new Date(NOW + 0.2 * DAY).toISOString(), NOW), 1);
  assert.equal(daysUntilPurge(new Date(NOW - DAY).toISOString(), NOW), 0);
  assert.equal(daysUntilPurge(null, NOW), null);
  assert.equal(daysUntilPurge("not-a-date", NOW), null);
});

test("휴지통 항목 안내 문구", () => {
  assert.equal(describePurge(new Date(NOW + 27 * DAY).toISOString(), NOW), "27일 뒤 영구 삭제됩니다.");
  assert.equal(describePurge(new Date(NOW + 0.5 * DAY).toISOString(), NOW), "내일 영구 삭제됩니다.");
  assert.equal(describePurge(new Date(NOW - 1).toISOString(), NOW), "보관 기간이 지나 곧 영구 삭제됩니다.");
  assert.equal(describePurge(undefined, NOW), "영구 삭제 예정일을 알 수 없습니다.");
  assert.equal(isRetentionExpired(new Date(NOW - 1).toISOString(), NOW), true);
  // purge_at을 모르면 서버 판정에 맡기므로 버튼을 막지 않는다.
  assert.equal(isRetentionExpired(undefined, NOW), false);
});

test("복구 409 만료 코드는 보관 기간 문구로 바꾼다", () => {
  assert.equal(describeRestoreError(new ApiError("x", 409, "TRASH_RETENTION_EXPIRED")), TRASH_RETENTION_EXPIRED_MESSAGE);
  assert.equal(describeRestoreError(new ApiError("x", 409, "WORKSPACE_TRASH_EXPIRED")), WORKSPACE_TRASH_EXPIRED_MESSAGE);
  assert.match(describeRestoreError(new ApiError("x", 403)), /소유자와 워크스페이스 OWNER/);
  assert.match(describeRestoreError(new ApiError("x", 409)), /다른 곳에서 바뀌어/);
  assert.equal(describeRestoreError(new Error("네트워크")), "네트워크");
});

test("복구는 POST .../restore에 base_version과 Idempotency-Key를 보낸다", async (t) => {
  const original = globalThis.window;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: { getItem: (key) => (key === "fruition.workspace_id" ? "ws_test" : null), setItem() {}, removeItem() {} }
  });
  t.after(() => { globalThis.window = original; });
  saveAccessToken("test-access");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method, JSON.parse(init.body), new Headers(init.headers).has("Idempotency-Key")]);
    return Response.json({ id: "doc_1", current_version: 3, deleted: false });
  });

  await restoreTrashDocument("doc_1", 2);

  assert.deepEqual(calls, [["/api/workspaces/ws_test/documents/doc_1/restore", "POST", { base_version: 2 }, true]]);
});
