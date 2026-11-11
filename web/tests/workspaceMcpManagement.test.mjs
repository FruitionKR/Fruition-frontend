import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { QueryClient } from "@tanstack/react-query";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match.js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !context.parentURL?.includes("/node_modules/") && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(specifier + ".ts", context);
    }
    return nextResolve(specifier, context);
  }
});

const auth = await import("../src/shared/lib/authSessionStorage.ts");
const api = await import("../src/entities/workspace/api/mcp.ts");
const management = await import("../src/features/user-settings/lib/workspaceMcpManagement.ts");
const apiErrors = await import("../src/shared/lib/apiErrors.ts");

const policy = (overrides = {}) => ({
  workspace_id: "workspace-a",
  enabled: false,
  allowed_scopes: [],
  generation: null,
  updated_at: null,
  ...overrides
});

const connection = (overrides = {}) => ({
  grant_id: "grant-a",
  workspace_id: "workspace-a",
  user_id: "user-a",
  client_id: "https://client.example/metadata",
  scopes: ["read"],
  status: "ACTIVE",
  revocation_reason: null,
  created_at: "2026-11-08T00:00:00Z",
  revoked_at: null,
  ...overrides
});

test("기본-off policy DTO와 workspace/user별 query key를 서버 값 그대로 쓴다", async (t) => {
  auth.saveAccessToken("workspace-mcp-test-access");
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/workspaces/workspace-a/mcp-policy");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.get("Authorization"), "Bearer workspace-mcp-test-access");
    return Response.json(policy());
  });
  assert.deepEqual(await api.fetchWorkspaceMcpPolicy("workspace-a"), policy());
  assert.deepEqual(management.workspaceMcpPolicyQueryKey("workspace-a", "user-a"), ["workspace-mcp-policy", "workspace-a", "user-a"]);
  assert.notDeepEqual(
    management.workspaceMcpConnectionsQueryKey("workspace-a", "user-a", 0),
    management.workspaceMcpConnectionsQueryKey("workspace-b", "user-a", 0)
  );
  assert.equal(management.workspaceMcpPolicyChanged(policy(), { enabled: false, allowed_scopes: [] }), false);
});

test("PUT은 enabled와 bounded scope 배열만 정확히 보내고 빈 scope를 허용한다", async (t) => {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/workspaces/workspace%2Fone/mcp-policy");
    assert.equal(init.method, "PUT");
    bodies.push(JSON.parse(init.body));
    return Response.json(policy({ workspace_id: "workspace/one", enabled: bodies.length === 2, allowed_scopes: bodies.at(-1).allowed_scopes }));
  });
  await api.updateWorkspaceMcpPolicy("workspace/one", { enabled: false, allowed_scopes: [] });
  await api.updateWorkspaceMcpPolicy("workspace/one", { enabled: true, allowed_scopes: ["read", "wiki_write"] });
  assert.deepEqual(bodies, [
    { enabled: false, allowed_scopes: [] },
    { enabled: true, allowed_scopes: ["read", "wiki_write"] }
  ]);
  assert.equal(management.workspaceMcpPolicyNeedsConfirmation(policy({ enabled: true }), { enabled: false, allowed_scopes: [] }), true);
  assert.equal(management.workspaceMcpPolicyNeedsConfirmation(policy(), { enabled: false, allowed_scopes: ["read"] }), true);
  assert.equal(management.workspaceMcpPolicyNeedsConfirmation(policy(), { enabled: true, allowed_scopes: [] }), false);
});

test("연결 목록은 user_id·서버 pagination을 보존하고 DELETE segment를 인코딩한다", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method ?? "GET"]);
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ connections: [connection()], page: 2, size: 20, has_next: true });
  });
  const result = await api.fetchWorkspaceMcpConnections("workspace/a", 2, 20);
  assert.equal(result.connections[0].user_id, "user-a");
  assert.deepEqual([result.page, result.size, result.has_next], [2, 20, true]);
  await api.revokeWorkspaceMcpConnection("workspace/a", "grant/one");
  assert.deepEqual(calls, [
    ["/api/workspaces/workspace%2Fa/mcp-connections?page=2&size=20", "GET"],
    ["/api/workspaces/workspace%2Fa/mcp-connections/grant%2Fone", "DELETE"]
  ]);
});

test("policy 저장은 captured workspace만 갱신하고 policy와 모든 connection page를 무효화한다", async (t) => {
  let resolveRequest;
  const request = new Promise((resolve) => { resolveRequest = resolve; });
  t.mock.method(globalThis, "fetch", async (path) => {
    assert.equal(path, "/api/workspaces/workspace-a/mcp-policy");
    await request;
    return Response.json(policy({ enabled: true, generation: 4 }));
  });
  const writes = [];
  const invalidations = [];
  const client = {
    setQueryData: (key, value) => writes.push([key, value]),
    invalidateQueries: async (options) => { invalidations.push(options); }
  };
  const saving = management.saveWorkspaceMcpPolicy(client, "workspace-a", "user-a", { enabled: true, allowed_scopes: [] });
  const workspaceB = policy({ workspace_id: "workspace-b", enabled: false });
  resolveRequest();
  await saving;
  assert.deepEqual(writes[0][0], ["workspace-mcp-policy", "workspace-a", "user-a"]);
  assert.equal(writes.some(([key]) => key.includes("workspace-b")), false);
  assert.equal(workspaceB.enabled, false);
  assert.deepEqual(invalidations.map(({ queryKey, exact, refetchType }) => [queryKey, exact ?? false, refetchType]), [
    [["workspace-mcp-policy", "workspace-a", "user-a"], true, "all"],
    [["workspace-mcp-connections", "workspace-a", "user-a"], false, "all"]
  ]);
});

test("force revoke는 204·404에서 해당 workspace cache만 지우고 5xx에서는 목록을 보존한다", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const aKey = management.workspaceMcpConnectionsQueryKey("workspace-a", "user-a", 0);
  const bKey = management.workspaceMcpConnectionsQueryKey("workspace-b", "user-a", 0);
  const aData = { connections: [connection(), connection({ grant_id: "keep" })], page: 0, size: 20, has_next: false };
  const bData = { connections: [connection()], page: 0, size: 20, has_next: false };
  let status = 204;
  t.mock.method(globalThis, "fetch", async () => status === 204
    ? new Response(null, { status })
    : Response.json({ error: { message: status === 404 ? "missing" : "access down" } }, { status }));

  client.setQueryData(aKey, aData);
  client.setQueryData(bKey, bData);
  assert.equal(await management.forceRevokeWorkspaceMcpConnection(client, "workspace-a", "user-a", "grant-a"), "revoked");
  assert.deepEqual(client.getQueryData(aKey).connections.map(({ grant_id }) => grant_id), ["keep"]);
  assert.equal(client.getQueryData(bKey).connections.length, 1);

  client.setQueryData(aKey, aData);
  status = 404;
  assert.equal(await management.forceRevokeWorkspaceMcpConnection(client, "workspace-a", "user-a", "grant-a"), "missing");
  assert.deepEqual(client.getQueryData(aKey).connections.map(({ grant_id }) => grant_id), ["keep"]);

  client.setQueryData(aKey, aData);
  status = 503;
  await assert.rejects(management.forceRevokeWorkspaceMcpConnection(client, "workspace-a", "user-a", "grant-a"), /access down/);
  assert.equal(client.getQueryData(aKey).connections.length, 2);
});

test("403/404/auth 실패는 inaccessible cache를 비우고 강한 revoke status를 보존한다", () => {
  const client = new QueryClient();
  client.setQueryData(management.workspaceMcpPolicyQueryKey("workspace-a", "user-a"), policy());
  client.setQueryData(management.workspaceMcpConnectionsQueryKey("workspace-a", "user-a", 0), { connections: [connection()] });
  client.setQueryData(management.workspaceMcpPolicyQueryKey("workspace-b", "user-a"), policy({ workspace_id: "workspace-b" }));
  assert.equal(management.isWorkspaceMcpAccessFailure(new apiErrors.ApiError("forbidden", 403)), true);
  assert.equal(management.isWorkspaceMcpAccessFailure(new apiErrors.LoginRequiredError("login")), true);
  management.clearWorkspaceMcpCache(client, "workspace-a", "user-a");
  assert.equal(client.getQueryData(management.workspaceMcpPolicyQueryKey("workspace-a", "user-a")), undefined);
  assert.ok(client.getQueryData(management.workspaceMcpPolicyQueryKey("workspace-b", "user-a")));
  assert.equal(management.canForceRevokeWorkspaceMcpConnection("ACTIVE"), true);
  assert.equal(management.canForceRevokeWorkspaceMcpConnection("USER_DISCONNECTED"), true);
  assert.equal(management.canForceRevokeWorkspaceMcpConnection("ADMIN_REVOKED"), false);
  assert.equal(management.canForceRevokeWorkspaceMcpConnection("SECURITY_REVOKED"), false);
  assert.equal(management.canForceRevokeWorkspaceMcpConnection("PURGED"), false);
});

function translator(locale, namespace) {
  const messages = JSON.parse(readFileSync(new URL(`../src/shared/i18n/messages/${locale}/settings.json`, import.meta.url), "utf8"));
  return (key, values = {}) => {
    const text = `${namespace}.${key}`.split(".").reduce((value, part) => value?.[part], { settings: messages });
    assert.equal(typeof text, "string", `${locale}:${namespace}.${key}`);
    return text.replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
  };
}

function loadComponent({ role = { isLoading: false, isOwner: true }, states, queries, mutations } = {}) {
  const source = readFileSync(new URL("../src/features/user-settings/ui/panels/WorkspaceMcpManagementSection.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  const exports = {};
  const updates = [];
  const queryClient = new QueryClient();
  const stateValues = states ? [...states] : [];
  const queryValues = queries ? [...queries] : [];
  const mutationValues = mutations ? [...mutations] : [];
  const element = (type, props, key) => ({ type, props, key });
  runInNewContext(outputText, {
    exports,
    require: (name) => ({
      react: {
        useEffect: (effect) => effect(),
        useRef: (current) => ({ current }),
        useState: (initial) => [stateValues.length ? stateValues.shift() : initial, (value) => updates.push(value)]
      },
      "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
      "next-intl": {
        useTranslations: (namespace) => translator("en", namespace),
        useFormatter: () => ({ dateTime: () => "localized date" })
      },
      "@tanstack/react-query": {
        useMutation: () => mutationValues.shift() ?? { isPending: false, mutate() {} },
        useQuery: () => queryValues.shift() ?? {},
        useQueryClient: () => queryClient
      },
      "@/entities/user": { useMe: () => ({ data: { id: "user-a" } }) },
      "@/entities/workspace": {
        WORKSPACE_MCP_SCOPES: api.WORKSPACE_MCP_SCOPES,
        fetchWorkspaceMcpConnections: async () => {},
        fetchWorkspaceMcpPolicy: async () => {},
        useSelectedWorkspace: () => ({ id: "workspace-a" }),
        useWorkspaceRole: () => role
      },
      "@/shared/lib/apiErrors": apiErrors,
      "@/shared/ui/modal/ConfirmModal": { ConfirmModal: (props) => element("confirm-modal", props) },
      "@/shared/ui/Switch": { Switch: (props) => element("switch", props) },
      "../../lib/workspaceMcpManagement": management,
      "../SettingsModal.module.css": { default: new Proxy({}, { get: (_, key) => String(key) }) },
      "../SettingsSectionHeader": { SettingsSectionHeader: (props) => element("header", props) },
      "./WorkspaceMcpManagementSection.module.css": { default: new Proxy({}, { get: (_, key) => String(key) }) }
    })[name]
  });
  return { exports, updates, queryClient };
}

function nodesOf(root) {
  const nodes = [];
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object") return;
    nodes.push(node);
    walk(node.props?.children);
  };
  walk(root);
  return nodes;
}

test("실제 section은 OWNER 확인 전 숨고 workspace/user key로 remount한다", () => {
  assert.equal(loadComponent({ role: { isLoading: true, isOwner: false } }).exports.WorkspaceMcpManagementSection(), null);
  assert.equal(loadComponent({ role: { isLoading: false, isOwner: false } }).exports.WorkspaceMcpManagementSection(), null);
  const tree = loadComponent().exports.WorkspaceMcpManagementSection();
  assert.equal(tree.type.name, "WorkspaceMcpManagement");
  assert.deepEqual({ workspaceId: tree.props.workspaceId, userId: tree.props.userId }, { workspaceId: "workspace-a", userId: "user-a" });
  assert.equal(tree.key, "workspace-a:user-a");
});

test("실제 관리 handler는 scope 토글을 확인 뒤에만 mutate하고 실패한 다음 페이지에서 이전을 유지한다", () => {
  const currentPolicy = policy({ enabled: true, allowed_scopes: ["read"], generation: 3 });
  const changed = { enabled: true, allowed_scopes: [] };
  const mutateCalls = [];
  const policyMutation = { isPending: false, mutate: (value) => mutateCalls.push(value) };
  const revokeMutation = { isPending: false, mutate() {} };
  const first = loadComponent({
    states: [1, null, false, null, null],
    queries: [
      { data: currentPolicy, isPending: false, isFetching: false, error: null },
      { data: undefined, isPending: false, isFetching: false, error: new Error("page failed") }
    ],
    mutations: [policyMutation, revokeMutation]
  });
  const tree = first.exports.WorkspaceMcpManagement({ workspaceId: "workspace-a", userId: "user-a" });
  const nodes = nodesOf(tree);
  assert.ok(!nodes.some((node) => node.type === "button" && node.props.children === "Save MCP policy"));
  const readSwitch = nodes.find((node) => node.type?.name === "Switch" && node.props.label === "Read shared workspace content");
  const previous = nodes.find((node) => node.type === "button" && node.props.children === "Previous");
  assert.equal(readSwitch.props.checked, true);
  assert.equal(previous.props.disabled, false);
  readSwitch.props.onClick();
  assert.deepEqual(mutateCalls, []);
  assert.ok(first.updates.some((value) => value?.kind === "policy" && value.update.allowed_scopes.length === 0));

  const confirming = loadComponent({
    states: [0, { kind: "policy", update: changed }, false, null, null],
    queries: [
      { data: currentPolicy, isPending: false, isFetching: false, error: null },
      { data: { connections: [], page: 0, size: 20, has_next: false }, isPending: false, isFetching: false, error: null }
    ],
    mutations: [policyMutation, revokeMutation]
  });
  const confirmTree = confirming.exports.WorkspaceMcpManagement({ workspaceId: "workspace-a", userId: "user-a" });
  const policyModal = nodesOf(confirmTree).find((node) => node.props?.titleId === "workspace-mcp-policy-confirm-title");
  policyModal.props.onConfirm();
  policyModal.props.onConfirm();
  assert.deepEqual(mutateCalls, [changed]);
});

test("실제 연결 handler는 특정 grant의 관리자 강제 회수를 확인 뒤에만 실행한다", () => {
  const target = connection({ status: "USER_DISCONNECTED" });
  const revokeCalls = [];
  const policyMutation = { isPending: false, mutate() {} };
  const revokeMutation = { isPending: false, mutate: (value) => revokeCalls.push(value) };
  const first = loadComponent({
    states: [0, null, false, null, null],
    queries: [
      { data: policy(), isPending: false, isFetching: false, error: null },
      { data: { connections: [target], page: 0, size: 20, has_next: false }, isPending: false, isFetching: false, error: null }
    ],
    mutations: [policyMutation, revokeMutation]
  });
  const tree = first.exports.WorkspaceMcpManagement({ workspaceId: "workspace-a", userId: "user-a" });
  nodesOf(tree).find((node) => node.type === "button" && node.props.children === "Force revoke").props.onClick();
  assert.deepEqual(revokeCalls, []);
  assert.ok(first.updates.some((value) => value?.kind === "revoke" && value.connection.grant_id === "grant-a"));

  const confirming = loadComponent({
    states: [0, { kind: "revoke", connection: target }, false, null, null],
    queries: [
      { data: policy(), isPending: false, isFetching: false, error: null },
      { data: { connections: [target], page: 0, size: 20, has_next: false }, isPending: false, isFetching: false, error: null }
    ],
    mutations: [policyMutation, revokeMutation]
  });
  const confirmTree = confirming.exports.WorkspaceMcpManagement({ workspaceId: "workspace-a", userId: "user-a" });
  const modal = nodesOf(confirmTree).find((node) => node.props?.titleId === "workspace-mcp-revoke-confirm-title");
  assert.match(modal.props.description, /administrator stop, not the member's own disconnect/);
  modal.props.onConfirm();
  modal.props.onConfirm();
  assert.deepEqual(revokeCalls, [target]);
});

test("exact workspace MCP routes precede catch-all and SAME_ORIGIN_API leaves them to ALB", async (t) => {
  const { default: local } = await import("../next.config.mjs?workspace-mcp-local");
  const rules = await local.rewrites();
  const expected = [
    "/api/workspaces/:wid/mcp-policy",
    "/api/workspaces/:wid/mcp-connections",
    "/api/workspaces/:wid/mcp-connections/:grantId"
  ];
  const catchAll = rules.findIndex((rule) => rule.source === "/api/:path*");
  for (const source of expected) {
    const index = rules.findIndex((rule) => rule.source === source);
    assert.ok(index >= 0 && index < catchAll, source);
  }
  assert.notEqual(getPathMatch(expected[1])("/api/workspaces/ws/mcp-connections"), false);
  assert.equal(getPathMatch(expected[1])("/api/workspaces/ws/mcp-connections/grant"), false);

  const old = process.env.SAME_ORIGIN_API;
  process.env.SAME_ORIGIN_API = "true";
  t.after(() => { if (old === undefined) delete process.env.SAME_ORIGIN_API; else process.env.SAME_ORIGIN_API = old; });
  const { default: sameOrigin } = await import("../next.config.mjs?workspace-mcp-same-origin");
  assert.deepEqual((await sameOrigin.rewrites()).filter((rule) => rule.source.includes("mcp-")), []);
});

test("workspace MCP 한영 catalog는 같은 key와 안전 고지를 가진다", () => {
  const load = (locale) => JSON.parse(readFileSync(new URL(`../src/shared/i18n/messages/${locale}/settings.json`, import.meta.url), "utf8")).workspace.mcp;
  const flatten = (value, prefix = "") => Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === "object" ? flatten(child, prefix ? `${prefix}.${key}` : key) : [prefix ? `${prefix}.${key}` : key]);
  const [ko, en] = [load("ko"), load("en")];
  assert.deepEqual(flatten(ko).sort(), flatten(en).sort());
  assert.match(en.identityWarning, /does not verify/);
  assert.match(en.lifecycleWarning, /does not undo committed changes/);
  assert.match(ko.availabilityWarning, /출시되었다는 뜻은 아닙니다/);
});
