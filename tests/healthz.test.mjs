import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  return nextResolve(specifier, context);
}});
const { GET } = await import("../app/healthz/route.ts");

test("헬스체크는 접근 코드 없이 캐시되지 않는 200을 준다", async () => {
  const response = GET();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
});
