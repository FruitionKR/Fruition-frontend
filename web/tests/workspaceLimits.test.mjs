import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });

const { describeLimitError, isFreeWorkspaceLimitReached } = await import("../src/entities/workspace/model/workspaceLimits.ts");
const { ApiError } = await import("../src/shared/lib/apiErrors.ts");

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
