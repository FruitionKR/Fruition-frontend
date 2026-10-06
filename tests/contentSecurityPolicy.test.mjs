import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  // route.ts가 확장자 없이 부르는 ./cspReport만 .ts로 푼다(next 내부 require는 건드리지 않는다)
  if (specifier.startsWith(".") && context.parentURL?.includes("/app/csp-report/") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
}});
const { buildContentSecurityPolicy, CSP_REPORT_PATH } = await import("../src/shared/lib/contentSecurityPolicy.mjs");
const { createLogLimiter, readCappedText, summarizeCspReports } = await import("../app/csp-report/cspReport.ts");
const { POST } = await import("../app/csp-report/route.ts");
const { getPathMatch } = await import("next/dist/shared/lib/router/utils/path-match.js");

const directives = (policy) => Object.fromEntries(policy.split("; ").map((entry) => {
  const [name, ...values] = entry.split(" ");
  return [name, values];
}));

test("이미지는 같은 출처·data:·blob:만 허용하고 위반은 /csp-report로 보고한다", () => {
  const policy = directives(buildContentSecurityPolicy());
  assert.deepEqual(policy["img-src"], ["'self'", "data:", "blob:"]);
  assert.deepEqual(policy["default-src"], ["'self'"]);
  assert.deepEqual(policy["object-src"], ["'none'"]);
  assert.deepEqual(policy["frame-ancestors"], ["'none'"]);
  assert.deepEqual(policy["base-uri"], ["'self'"]);
  assert.deepEqual(policy["form-action"], ["'self'"]);
  assert.deepEqual(policy["font-src"], ["'self'", "data:"]);
  assert.ok(policy["frame-src"].includes("blob:"));
  assert.deepEqual(policy["report-uri"], [CSP_REPORT_PATH]);
  assert.deepEqual(policy["connect-src"], ["'self'", "https://*.amazonaws.com"]);
});

test("BACKEND_URL이 있으면 문서 API 오리진을 connect-src에 더한다", () => {
  const policy = directives(buildContentSecurityPolicy({ backendUrl: "https://document.example.com/base/" }));
  assert.deepEqual(policy["connect-src"], ["'self'", "https://document.example.com", "https://*.amazonaws.com"]);
});

async function loadConfig(t, nodeEnv) {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  t.after(() => { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; });
  return (await import(`../next.config.mjs?node-env=${nodeEnv}`)).default;
}

test("production 화면 응답에만 Report-Only CSP를 붙이고 API·정적 청크는 뺀다", async (t) => {
  const config = await loadConfig(t, "production");
  const [rule] = await config.headers();
  assert.equal(rule.headers[0].key, "Content-Security-Policy-Report-Only");
  assert.match(rule.headers[0].value, /img-src 'self' data: blob:/);
  // Next가 headers()의 source를 해석하는 것과 같은 matcher로 확인한다
  const matches = getPathMatch(rule.source);
  assert.ok(matches("/"));
  assert.ok(matches("/workspaces/ws"));
  assert.equal(matches("/api/workspaces/ws/documents"), false);
  assert.equal(matches("/_next/static/chunks/a.js"), false);
});

test("개발 서버(HMR eval·websocket)에는 CSP를 붙이지 않는다", async (t) => {
  const config = await loadConfig(t, "development");
  assert.deepEqual(await config.headers(), []);
});

test("두 보고 형식에서 지시어와 차단 오리진만 남긴다", () => {
  const legacy = JSON.stringify({ "csp-report": {
    "document-uri": "https://app.example/workspaces/ws/documents/secret",
    "effective-directive": "img-src",
    "blocked-uri": "https://attacker.example/p.png?q=회의 내용",
    "script-sample": "secret"
  } });
  assert.deepEqual(summarizeCspReports(legacy), [{ directive: "img-src", blocked: "https://attacker.example" }]);

  const reportingApi = JSON.stringify([
    { type: "csp-violation", body: { effectiveDirective: "script-src-elem", blockedURL: "inline", documentURL: "https://app.example/x" } },
    { type: "deprecation", body: { id: "x" } },
    { type: "csp-violation", body: { effectiveDirective: "img-src\n[evil] log", blockedURL: "data:image/png;base64,AA" } },
    { type: "csp-violation", body: { "violated-directive": "frame-src blob:", blockedURL: "javascript:alert(1)" } }
  ]);
  assert.deepEqual(summarizeCspReports(reportingApi), [
    { directive: "script-src-elem", blocked: "inline" },
    { directive: "img-src", blocked: "data" },
    { directive: "frame-src", blocked: "other" }
  ]);
  assert.deepEqual(summarizeCspReports("{not json"), []);
  assert.deepEqual(summarizeCspReports("null"), []);
  assert.equal(summarizeCspReports(JSON.stringify(Array.from({ length: 50 }, () => ({ type: "csp-violation", body: {} })))).length, 10);
});

test("URL이 아닌 blocked 값은 CSP 키워드만 그대로 남기고 나머지는 other로 줄인다", () => {
  const report = (blocked) => JSON.stringify({ "csp-report": { "effective-directive": "script-src-elem", "blocked-uri": blocked } });
  for (const keyword of ["inline", "eval", "wasm-eval", "trusted-types-policy", "trusted-types-sink", "self", "data", "blob", "EVAL"]) {
    assert.deepEqual(summarizeCspReports(report(keyword)), [{ directive: "script-src-elem", blocked: keyword.toLowerCase() }], keyword);
  }
  for (const value of ["fake-admin-logged-in-ok", "inline-x", "관리자 로그인 성공", "not a url"]) {
    assert.deepEqual(summarizeCspReports(report(value)), [{ directive: "script-src-elem", blocked: "other" }], value);
  }
  assert.deepEqual(summarizeCspReports(report("")), [{ directive: "script-src-elem", blocked: "unknown" }]);
});

test("보고 본문은 상한까지만 읽고, 로그는 시간 창마다 상한까지만 남긴다", async () => {
  const stream = (text) => new Blob([text]).stream();
  assert.equal(await readCappedText(stream("abc"), 3), "abc");
  assert.equal(await readCappedText(stream("abcd"), 3), null);
  const take = createLogLimiter(2, 1000);
  assert.deepEqual([take(0), take(10), take(20), take(30), take(1000), take(1010)], [
    { allowed: true, dropped: 0 },
    { allowed: true, dropped: 0 },
    { allowed: false, dropped: 0 },
    { allowed: false, dropped: 0 },
    // 새 창의 첫 호출이 직전 창에서 버린 건수를 한 번만 넘겨준다
    { allowed: true, dropped: 2 },
    { allowed: true, dropped: 0 }
  ]);
});

test("보고 엔드포인트는 내용과 관계없이 캐시되지 않는 204를 돌려준다", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const body = JSON.stringify({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://attacker.example/p?q=1" } });
  const response = await POST(new Request("http://localhost/csp-report", { method: "POST", headers: { "content-type": "application/csp-report" }, body }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(warn.mock.calls[0].arguments[0], "[csp-report] img-src https://attacker.example");

  const tooLarge = await POST(new Request("http://localhost/csp-report", { method: "POST", body: "x".repeat(17 * 1024) }));
  assert.equal(tooLarge.status, 204);
  assert.equal(warn.mock.calls.length, 1);
});

test("로그 상한을 넘긴 보고는 버리고 다음 창에서 버린 건수를 한 줄로 남긴다", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  // 앞 테스트가 같은 모듈 상한을 썼으므로 새 창에서 시작한다
  const start = Date.now() + 3_600_000;
  const clock = t.mock.method(Date, "now", () => start);
  const send = (count) => POST(new Request("http://localhost/csp-report", {
    method: "POST",
    body: JSON.stringify(Array.from({ length: count }, (_, index) => ({ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: `https://a${index}.example/x` } })))
  }));
  for (let i = 0; i < 7; i += 1) await send(10);
  const lines = warn.mock.calls.map((call) => call.arguments[0]);
  assert.equal(lines.length, 60);
  assert.ok(lines.every((line) => line.startsWith("[csp-report] img-src https://")));

  clock.mock.mockImplementation(() => start + 60_000);
  await send(1);
  const next = warn.mock.calls.slice(60).map((call) => call.arguments[0]);
  assert.deepEqual(next, ["[csp-report] dropped 10 reports in previous window", "[csp-report] img-src https://a0.example"]);
});

test("CSP 보고 요약은 알려진 키워드를 남기고 지나치게 긴 오리진은 잘라 둔다", () => {
  const keywords = ["mediastream", "filesystem", "about"].map((blocked) => ({ "csp-report": { "effective-directive": "img-src", "blocked-uri": blocked } }));
  assert.deepEqual(keywords.flatMap((report) => summarizeCspReports(JSON.stringify(report))).map((summary) => summary.blocked), ["mediastream", "filesystem", "about"]);
  const longHost = `https://${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.example/x?q=secret`;
  const [summary] = summarizeCspReports(JSON.stringify({ "csp-report": { "effective-directive": "img-src", "blocked-uri": longHost } }));
  assert.ok(summary.blocked.length <= 200);
  assert.ok(summary.blocked.startsWith("https://aaaa"));
  assert.doesNotMatch(summary.blocked, /secret/);
});
