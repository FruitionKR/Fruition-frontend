import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { QueryClient } from "@tanstack/react-query";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

const { fetchOwnedMcpRuns } = await import("../src/entities/user/api/mcpRuns.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
const apiErrors = await import("../src/shared/lib/apiErrors.ts");
const runHelpers = await import("../src/features/user-settings/lib/mcpConnectionRuns.ts");
const approvalHelpers = await import("../src/features/mcp-approval/lib/mcpApproval.ts");

test("owned MCP run API sends only the encoded server locator and bounded cursor pagination", async (t) => {
  saveAccessToken("owned-run-access");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method ?? "GET", init.cache, init.headers.get("Authorization")]);
    return Response.json({ items: [{ run_id: "run/1", status: "executing" }], next_cursor: "next cursor" });
  });

  const first = await fetchOwnedMcpRuns("workspace/one", "grant / one");
  const next = await fetchOwnedMcpRuns("workspace/one", "grant / one", "created/run cursor");

  assert.deepEqual(first, { items: [{ run_id: "run/1", status: "executing" }], next_cursor: "next cursor" });
  assert.equal(next.next_cursor, "next cursor");
  assert.deepEqual(calls, [
    ["/api/workspaces/workspace%2Fone/agent/mcp-runs?grant_id=grant+%2F+one&limit=20", "GET", "no-store", "Bearer owned-run-access"],
    ["/api/workspaces/workspace%2Fone/agent/mcp-runs?grant_id=grant+%2F+one&cursor=created%2Frun+cursor&limit=20", "GET", "no-store", "Bearer owned-run-access"]
  ]);
  assert.ok(calls.every(([path]) => !path.includes("user_id")));
});

test("run query identity isolates account, workspace, grant, cursor, and late responses", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const firstKey = runHelpers.mcpConnectionRunsQueryKey("user-a", "workspace-a", "grant-a", null);
  const nextKey = runHelpers.mcpConnectionRunsQueryKey("user-a", "workspace-a", "grant-a", "cursor-2");
  const otherKey = runHelpers.mcpConnectionRunsQueryKey("user-b", "workspace-b", "grant-b", null);
  assert.deepEqual(firstKey, ["mcp-connection-runs", "user-a", "workspace-a", "grant-a", null]);
  assert.notDeepEqual(firstKey, nextKey);
  assert.notDeepEqual(firstKey, otherKey);

  let resolveOld;
  let resolveCurrent;
  const oldRequest = client.fetchQuery({ queryKey: firstKey, queryFn: () => new Promise((resolve) => { resolveOld = resolve; }) });
  const currentRequest = client.fetchQuery({ queryKey: otherKey, queryFn: () => new Promise((resolve) => { resolveCurrent = resolve; }) });
  resolveCurrent({ items: [{ run_id: "run-current", status: "completed" }], next_cursor: null });
  await currentRequest;
  resolveOld({ items: [{ run_id: "run-old", status: "completed" }], next_cursor: null });
  await oldRequest;
  assert.equal(client.getQueryData(otherKey).items[0].run_id, "run-current");
  assert.equal(client.getQueryData(firstKey).items[0].run_id, "run-old");
});

function catalogTranslator(locale, namespace) {
  const settings = JSON.parse(readFileSync(new URL(`../src/shared/i18n/messages/${locale}/settings.json`, import.meta.url), "utf8"));
  const shared = JSON.parse(readFileSync(new URL(`../src/shared/i18n/messages/${locale}/shared.json`, import.meta.url), "utf8"));
  const messages = { settings, shared };
  return (key, values = {}) => {
    const value = `${namespace}.${key}`.split(".").reduce((current, part) => current?.[part], messages);
    assert.equal(typeof value, "string", `missing ${locale} translation: ${namespace}.${key}`);
    return value.replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
  };
}

function panelHarness(queryClient, queryResult, locale = "en") {
  const source = readFileSync(new URL("../src/features/user-settings/ui/panels/McpConnectionRunsPanel.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const state = [];
  const queryOptions = [];
  const effects = [];
  const listeners = {};
  const connection = {
    grant_id: "grant/one", workspace_id: "workspace/one", client_id: "Example Client", scopes: [], status: "USER_DISCONNECTED",
    revocation_reason: "USER_DISCONNECTED", created_at: "2026-11-08T00:00:00Z", revoked_at: "2026-11-08T01:00:00Z"
  };
  let result = queryResult;

  function render() {
    let hook = 0;
    effects.length = 0;
    const exports = {};
    const element = (type, props) => ({ type, props });
    runInNewContext(outputText, {
      exports,
      window: {
        addEventListener: (name, listener) => { listeners[name] = listener; },
        removeEventListener: (name) => { delete listeners[name]; }
      },
      require: (name) => ({
        react: {
          useEffect: (effect) => effects.push(effect),
          useState: (initial) => {
            const index = hook++;
            if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
            return [state[index], (update) => { state[index] = typeof update === "function" ? update(state[index]) : update; }];
          }
        },
        "react/jsx-runtime": { jsx: element, jsxs: element },
        "next/link": { __esModule: true, default: "a" },
        "next-intl": { useTranslations: (namespace) => catalogTranslator(locale, namespace) },
        "@tanstack/react-query": {
          useQueryClient: () => queryClient,
          useQuery: (options) => { queryOptions.push(options); return result; }
        },
        "@/entities/user": { fetchOwnedMcpRuns: async () => { throw new Error("queryFn is only called by React Query"); } },
        "@/features/mcp-approval/lib/mcpApproval": approvalHelpers,
        "@/shared/lib/apiErrors": apiErrors,
        "../../lib/mcpConnectionRuns": runHelpers,
        "../SettingsModal.module.css": { default: {} },
        "./McpConnectionRunsPanel.module.css": { default: {} }
      })[name]
    });
    return exports.McpConnectionRunsPanel({ userId: "user-one", connection });
  }

  return { connection, effects, listeners, queryOptions, render, setResult: (next) => { result = next; } };
}

function find(node, predicate) {
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  return [node.props?.children].flat(Infinity).map((child) => find(child, predicate)).find(Boolean);
}

test("selected disconnected connection shows actual runs, existing review routes, and recovers from a failed next page", () => {
  const client = new QueryClient();
  const firstPage = { data: { items: [{ run_id: "run / one", status: "executing" }], next_cursor: "cursor two" }, error: null, isPending: false, isFetching: false, refetch: async () => ({}) };
  const harness = panelHarness(client, firstPage);
  let tree = harness.render();
  assert.deepEqual(harness.queryOptions.at(-1).queryKey, ["mcp-connection-runs", "user-one", "workspace/one", "grant/one", null]);
  assert.equal(find(tree, (node) => node.type === "a").props.href, "/mcp/workspaces/workspace%2Fone/runs/run%20%2F%20one");
  assert.equal(find(tree, (node) => node.type === "button" && node.props.children === "Cancel"), undefined, "opening history never cancels");
  assert.match(JSON.stringify(tree), /work approved before disconnecting may continue/);
  assert.match(JSON.stringify(tree), /Fees for changes already committed are not refunded/);

  find(tree, (node) => node.type === "button" && node.props.children === "Next").props.onClick();
  harness.setResult({ data: undefined, error: new TypeError("Failed to fetch"), isPending: false, isFetching: false, refetch: async () => ({}) });
  tree = harness.render();
  assert.deepEqual(harness.queryOptions.at(-1).queryKey, ["mcp-connection-runs", "user-one", "workspace/one", "grant/one", "cursor two"]);
  find(tree, (node) => node.type === "button" && node.props.children === "Previous").props.onClick();
  harness.setResult(firstPage);
  tree = harness.render();
  assert.equal(find(tree, (node) => node.type === "a").props.href, "/mcp/workspaces/workspace%2Fone/runs/run%20%2F%20one");
  client.clear();
});

test("foreign, absent, and authentication failures hide and clear scoped run data", () => {
  for (const error of [
    new apiErrors.ApiError("foreign", 403),
    new apiErrors.ApiError("absent", 404),
    new apiErrors.LoginRequiredError("login")
  ]) {
    const client = new QueryClient();
    const key = runHelpers.mcpConnectionRunsQueryKey("user-one", "workspace/one", "grant/one", null);
    client.setQueryData(key, { items: [{ run_id: "stale-run", status: "completed" }], next_cursor: null });
    const harness = panelHarness(client, { data: client.getQueryData(key), error, isPending: false, isFetching: false, refetch: async () => ({}) });
    const tree = harness.render();
    assert.equal(find(tree, (node) => node.type === "a"), undefined);
    harness.effects[0]();
    assert.equal(client.getQueryData(key), undefined);
    client.clear();
  }
});

test("sign-out clears every account's cached connection runs", () => {
  const client = new QueryClient();
  const oldKey = runHelpers.mcpConnectionRunsQueryKey("old-user", "workspace-one", "grant-one", null);
  const otherKey = runHelpers.mcpConnectionRunsQueryKey("other-user", "workspace-two", "grant-two", null);
  client.setQueryData(oldKey, { items: [{ run_id: "old-run", status: "completed" }], next_cursor: null });
  client.setQueryData(otherKey, { items: [{ run_id: "other-run", status: "completed" }], next_cursor: null });
  const harness = panelHarness(client, { data: { items: [], next_cursor: null }, error: null, isPending: false, isFetching: false, refetch: async () => ({}) });
  harness.render();
  harness.effects[1]();
  harness.listeners["fruition:auth-cleared"]();
  assert.equal(client.getQueryData(oldKey), undefined);
  assert.equal(client.getQueryData(otherKey), undefined);
  client.clear();
});
