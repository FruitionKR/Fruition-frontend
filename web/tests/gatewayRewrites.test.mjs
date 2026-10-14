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

test("데스크톱 빌드는 standalone으로 만들고, 문서 API도 앱 안의 Next가 운영 서버로 중계한다", async (t) => {
  const keys = ["DESKTOP_BUILD", "ACCESS_URL", "BACKEND_URL", "DESKTOP_WEB_URL", "SAME_ORIGIN_API"];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    DESKTOP_BUILD: "true", ACCESS_URL: "https://fruition.example", BACKEND_URL: "https://fruition.example", DESKTOP_WEB_URL: "https://web.fruition.example"
  });
  delete process.env.SAME_ORIGIN_API;
  t.after(() => keys.forEach((key) => { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }));
  const config = (await import("../next.config.mjs?desktop=true")).default;

  assert.equal(config.output, "standalone");
  // 앱 화면은 localhost에서 뜨므로 문서 API를 다른 출처로 직접 부르면 CORS가 필요하다. 중계로 같은 출처를 유지한다.
  assert.equal(config.env.NEXT_PUBLIC_DOCUMENT_DIRECT_API, "false");
  const rewrites = await config.rewrites();
  assert.equal(rewrites.afterFiles.find((route) => route.source === "/api/:path*")?.destination, "https://fruition.example/api/:path*");
  // 운영은 /api마다 접근 코드 쿠키를 확인한다. 앱 안의 /access/verify 대신 운영 웹으로 보내 쿠키를 localhost에 받는다.
  assert.deepEqual(rewrites.beforeFiles, [{ source: "/access/verify", destination: "https://web.fruition.example/access/verify" }]);
});
