import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const calls = [];
globalThis.__analyticsFake = {
  init(token, options) { calls.push({ method: "init", token, options }); },
  capture(event, properties, options) { calls.push({ method: "capture", event, properties, options }); },
  identify(id) { calls.push({ method: "identify", id }); },
  group(type, id) { calls.push({ method: "group", type, id }); },
  resetGroups() {},
  reset() { calls.push({ method: "reset" }); },
  get_session_id() { return "session_browser"; },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "posthog-js") return { url: "data:text/javascript,export default globalThis.__analyticsFake", shortCircuit: true };
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const { initializeAnalytics, captureAnalytics, identifyAnalytics, setAnalyticsWorkspace, resetAnalytics, analyticsSessionHeaders } = await import("../src/shared/lib/analytics/client.ts");

test("수집 토큰이 없거나 개인 키이면 SDK를 로드하지 않는다", async () => {
  await initializeAnalytics({ token: "", environment: "local", appVersion: "test" });
  await initializeAnalytics({ token: "phx_personal_test", environment: "local", appVersion: "test" });
  assert.equal(calls.length, 0);
});

test("SDK·사용자 준비 전에 열린 화면도 원래 발생 시각과 대상 워크스페이스로 기록한다", async (t) => {
  globalThis.window = { localStorage: { getItem: () => "ws_original" } };
  t.after(() => { delete globalThis.window; });
  const started = Date.now();
  captureAnalytics("graph_opened", {});
  assert.equal(calls.length, 0);
  await initializeAnalytics({ token: "phc_public_test", environment: "staging", appVersion: "test-sha" });
  setAnalyticsWorkspace("ws_selected_later");
  identifyAnalytics("user_first");
  const event = calls.find(call => call.event === "graph_opened");
  assert.equal(event.properties.workspace_id, "ws_original");
  assert.deepEqual(event.properties.$groups, { workspace: "ws_original" });
  assert.equal(event.properties.environment, "staging");
  assert.equal(event.properties.app_version, "test-sha");
  assert.ok(event.options.timestamp.getTime() >= started);
  assert.ok(event.options.timestamp.getTime() <= Date.now());
  assert.ok(calls.findIndex(call => call.method === "identify") < calls.indexOf(event));
  assert.deepEqual(analyticsSessionHeaders(), { "X-PostHog-Session-Id": "session_browser" });
});

test("로그아웃 때 대기 이벤트·세션 연결을 지워 다음 계정으로 넘기지 않는다", () => {
  resetAnalytics();
  assert.deepEqual(analyticsSessionHeaders(), {});
  captureAnalytics("citation_opened", { query_id: "old_query", rank: 1, citation_type: "internal" }, "ws_old");
  resetAnalytics();
  identifyAnalytics("user_second");
  assert.equal(calls.some(call => call.properties?.query_id === "old_query"), false);
});

test("자동 수집·리플레이·원격 기능 평가는 꺼 두고 전송 경계 필터를 설치한다", () => {
  const { options } = calls.find(call => call.method === "init");
  assert.equal(options.autocapture, false);
  assert.equal(options.disable_session_recording, true);
  assert.equal(options.advanced_disable_flags, true);
  assert.equal(options.disable_external_dependency_loading, true);
  assert.equal(options.capture_pageview, false);
  assert.equal(typeof options.before_send, "function");
});
