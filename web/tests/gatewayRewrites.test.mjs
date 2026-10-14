import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../next.config.mjs";

// next.config.mjs는 import 시점의 환경변수로 값을 정한다. 다른 환경은 쿼리로 새 모듈을 읽는다.
async function loadConfig(t, value) {
  const old = process.env.SAME_ORIGIN_API;
  process.env.SAME_ORIGIN_API = value;
  t.after(() => { if (old === undefined) delete process.env.SAME_ORIGIN_API; else process.env.SAME_ORIGIN_API = old; });
  return (await import(`../next.config.mjs?same-origin=${value}`)).default;
}

test("workspace 복구 요청은 access-svc로 전달한다", async () => {
  const rewrites = await nextConfig.rewrites();
  const restore = rewrites.find((route) => route.source === "/api/workspaces/:wid/restore");
  const accessUrl = process.env.ACCESS_URL || "http://localhost:8081";

  assert.equal(restore?.destination, `${accessUrl}/api/workspaces/:wid/restore`);
});

test("ALB가 경로를 나누는 같은 출처 배포에서는 Next가 API를 중계하지 않는다", async (t) => {
  const config = await loadConfig(t, "true");

  assert.deepEqual(await config.rewrites(), []);
  assert.deepEqual(await config.redirects(), []);
  assert.equal(config.output, "standalone");
  assert.equal(config.env.NEXT_PUBLIC_DOCUMENT_DIRECT_API, "true");
});
