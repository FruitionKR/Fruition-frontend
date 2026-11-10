import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const auth = await import("../src/shared/lib/authSessionStorage.ts");
const mcp = await import("../src/features/mcp-authorization/api/mcpAuthorization.ts");
const { analyticsLocation } = await import("../src/shared/lib/analytics/sanitize.ts");

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value)
  };
}

const originalWindow = globalThis.window;
globalThis.window = { localStorage: storage(), sessionStorage: storage(), dispatchEvent() {} };
test.after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });

const future = () => new Date(Date.now() + 60_000).toISOString();
const pending = (overrides = {}) => ({
  pending_id: "123e4567-e89b-42d3-a456-426614174000",
  client_id: "https://client.example/metadata",
  client_name: "Server Client",
  redirect_host: "127.0.0.1",
  app_identity_verified: false,
  scopes: ["read"],
  workspaces: [{ workspace_id: "ws-server", workspace_name: "Server Workspace", role: "OWNER", policy_generation: 3 }],
  expires_at: future(),
  ...overrides
});

function session(overrides = {}) {
  auth.saveAccessToken("decision-access");
  return {
    pending: mcp.parsePendingAuthorization(pending()),
    csrfToken: "csrf-from-preview",
    accessToken: "decision-access",
    accessTokenVersion: auth.getAccessTokenVersion(),
    decisionStarted: false,
    ...overrides
  };
}

test("OAuth query는 원래 encoding을 보존하고 unknown·duplicate·malformed·oversize를 거절한다", () => {
  const query = "?response_type=code&client_id=https%3A%2F%2Fclient.example%2Fmetadata&redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback&scope=read&state=a%2Bb%2520&code_challenge=challenge&code_challenge_method=S256&resource=https%3A%2F%2Fmcp.example%2Fmcp";
  assert.equal(mcp.authorizationResumePath(query), `/mcp/authorize${query}`);

  for (const hostile of [
    "?response_type=code&next=%2F%2Fevil.example",
    "?state=one&state=two",
    "?st%61te=encoded-name",
    "?state=%ZZ",
    "?state=%E0%A4%A",
    "?state"
  ]) assert.throws(() => mcp.authorizationResumePath(hostile), { code: "INVALID_QUERY" });
  assert.throws(() => mcp.authorizationResumePath(`?state=${"a".repeat(4096)}`), { code: "INVALID_QUERY" });
});

test("public consent route는 analytics에 OAuth query나 client 값을 남기지 않는다", () => {
  const clean = analyticsLocation("https://app.example/mcp/authorize?state=secret-state&client_id=secret-client");
  assert.deepEqual(clean, { $current_url: "https://app.example/:route", $pathname: "/:route" });
  assert.doesNotMatch(JSON.stringify(clean), /secret|client_id|state/);
});

test("preview는 만료 Bearer의 refresh 뒤 cookie·JSON Accept로 원 query를 보낸다", async (t) => {
  auth.saveAccessToken("expired-access");
  const query = "?response_type=code&client_id=client&redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Fcallback&scope=read&state=encoded%2Bstate&code_challenge=challenge&code_challenge_method=S256&resource=https%3A%2F%2Fmcp.example%2Fmcp";
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push({ path, init, authorization: init.headers?.get("Authorization") ?? null });
    if (path === "/api/auth/refresh") return Response.json({ access_token: "preview-access" });
    if (init.headers.get("Authorization") === "Bearer expired-access") return new Response(null, { status: 401 });
    return Response.json(pending(), { headers: { "X-CSRF-TOKEN": "csrf-from-server" } });
  });

  const result = await mcp.previewMcpAuthorization(query);
  assert.equal(result.csrfToken, "csrf-from-server");
  assert.equal(result.accessToken, "preview-access");
  assert.deepEqual(calls.map((call) => [call.path, call.authorization]), [
    [`/oauth2/authorize${query}`, "Bearer expired-access"],
    ["/api/auth/refresh", null],
    [`/oauth2/authorize${query}`, "Bearer preview-access"]
  ]);
  for (const call of [calls[0], calls[2]]) {
    assert.equal(call.init.credentials, "include");
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.headers.get("Accept"), "application/json");
  }
});

test("reload restores memory Bearer before cookie-authenticated consent returns 200", async (t) => {
  auth.clearAuth();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    const bearer = init.headers?.get("Authorization") ?? null;
    calls.push([path, bearer]);
    if (path === "/api/auth/me") return bearer
      ? Response.json({ id: "user" })
      : new Response(null, { status: 401 });
    if (path === "/api/auth/refresh") return Response.json({ access_token: "restored-access" });
    // JSESSIONID accepts this request even without a memory access token.
    return Response.json(pending(), { headers: { "X-CSRF-TOKEN": "session-csrf" } });
  });
  const result = await mcp.previewMcpAuthorization("?scope=read");
  assert.equal(result.accessToken, "restored-access");
  assert.equal(result.accessTokenVersion, auth.getAccessTokenVersion());
  assert.equal(result.csrfToken, "session-csrf");
  assert.deepEqual(calls, [
    ["/api/auth/me", null],
    ["/api/auth/refresh", null],
    ["/api/auth/me", "Bearer restored-access"],
    ["/oauth2/authorize?scope=read", "Bearer restored-access"]
  ]);
});

test("first login uses its memory token without restoring the session", async (t) => {
  auth.saveAccessToken("login-access");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.headers.get("Authorization")]);
    return Response.json(pending(), { headers: { "X-CSRF-TOKEN": "login-csrf" } });
  });
  const result = await mcp.previewMcpAuthorization("?scope=read");
  assert.equal(result.accessToken, "login-access");
  assert.deepEqual(calls, [["/oauth2/authorize?scope=read", "Bearer login-access"]]);
  auth.clearAuth();
  await assert.rejects(mcp.decideMcpAuthorization(result, "DENY"), { code: "AUTH_CHANGED" });
  assert.equal(calls.length, 1);
});

test("rejected reload session requires login without requesting consent", async (t) => {
  for (const status of [401, 403]) {
    auth.clearAuth();
    const calls = [];
    const mock = t.mock.method(globalThis, "fetch", async (path) => {
      calls.push(path);
      return new Response(null, { status: path === "/api/auth/refresh" ? status : 401 });
    });
    await assert.rejects(mcp.previewMcpAuthorization("?scope=read"), { name: "LoginRequiredError" });
    assert.deepEqual(calls, ["/api/auth/me", "/api/auth/refresh"]);
    assert.equal(auth.getAccessToken(), null);
    mock.mock.restore();
  }
});

test("pending DTO는 서버 계약의 값만 받고 workspace·scope·expiry를 검증한다", () => {
  assert.equal(mcp.parsePendingAuthorization(pending()).workspaces[0].workspace_name, "Server Workspace");
  for (const invalid of [
    pending({ scopes: ["admin"] }),
    pending({ scopes: ["read", "read"] }),
    pending({ workspaces: [{ workspace_id: "ws", workspace_name: "Name", role: "ADMIN", policy_generation: 1 }] }),
    pending({ expires_at: "not-a-date" }),
    pending({ app_identity_verified: true })
  ]) assert.throws(() => mcp.parsePendingAuthorization(invalid), { code: "INVALID_PREVIEW" });
  assert.equal(mcp.isPendingExpired({ expires_at: new Date(Date.now() - 1).toISOString() }), true);
});

test("workspace scopes는 실제 부여 범위로 파싱하고 누락 시 요청 범위로 대체하며 잘못된 값은 거절한다", () => {
  const requested = ["read", "write_propose", "wiki_write"];
  const workspace = (extra) => ({ workspace_id: "ws-read", workspace_name: "Read Only", role: "MEMBER", policy_generation: 2, ...extra });

  const parsed = mcp.parsePendingAuthorization(pending({ scopes: requested, workspaces: [workspace({ scopes: ["read"] })] }));
  assert.deepEqual(parsed.scopes, requested);
  assert.deepEqual(parsed.workspaces[0].scopes, ["read"]);

  const legacy = mcp.parsePendingAuthorization(pending({ scopes: requested, workspaces: [workspace({})] }));
  assert.deepEqual(legacy.workspaces[0].scopes, requested);

  for (const scopes of [["admin"], ["read", "read"], [], ["wiki_write"], "read", null]) {
    assert.throws(
      () => mcp.parsePendingAuthorization(pending({ scopes: ["read", "write_propose"], workspaces: [workspace({ scopes })] })),
      { code: "INVALID_PREVIEW" },
      JSON.stringify(scopes)
    );
  }
});

test("approve와 deny는 preview Bearer·cookie·CSRF로 허용된 body만 한 번 전송한다", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init]);
    return Response.json({ redirect_uri: "http://127.0.0.1:43123/callback?code=server-code&state=server-state" });
  });

  const approved = session();
  assert.equal(await mcp.decideMcpAuthorization(approved, "APPROVE", "ws-server"), "http://127.0.0.1:43123/callback?code=server-code&state=server-state");
  const denied = session();
  await mcp.decideMcpAuthorization(denied, "DENY");

  assert.deepEqual(calls.map(([path, init]) => [path, JSON.parse(init.body)]), [
    ["/oauth2/authorize/123e4567-e89b-42d3-a456-426614174000", { decision: "APPROVE", workspace_id: "ws-server" }],
    ["/oauth2/authorize/123e4567-e89b-42d3-a456-426614174000", { decision: "DENY" }]
  ]);
  for (const [, init] of calls) {
    assert.equal(init.credentials, "include");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.Authorization, "Bearer decision-access");
    assert.equal(init.headers["X-CSRF-TOKEN"], "csrf-from-preview");
    assert.equal(init.headers.Accept, "application/json");
  }
});

test("double click와 실패는 POST를 재시도하지 않는다", async (t) => {
  let finish;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return await new Promise((resolve) => { finish = resolve; });
  });
  const current = session();
  const first = mcp.decideMcpAuthorization(current, "APPROVE", "ws-server");
  await assert.rejects(mcp.decideMcpAuthorization(current, "APPROVE", "ws-server"), { code: "DECISION_STARTED" });
  assert.equal(calls, 1);
  finish(Response.json({ redirect_uri: "https://client.example/callback?code=server" }));
  await first;
  await assert.rejects(mcp.decideMcpAuthorization(current, "APPROVE", "ws-server"), { code: "DECISION_STARTED" });
  assert.equal(calls, 1);
});

test("5xx·401 decision, 만료, 비대상 workspace, 인증 변경은 자동 재전송하지 않는다", async (t) => {
  let calls = 0;
  const statuses = [500, 401];
  t.mock.method(globalThis, "fetch", async () => { calls += 1; return new Response(null, { status: statuses.shift() }); });
  for (const status of [500, 401]) {
    const failed = session();
    await assert.rejects(mcp.decideMcpAuthorization(failed, "DENY"), { code: "DECISION_FAILED" }, String(status));
    await assert.rejects(mcp.decideMcpAuthorization(failed, "DENY"), { code: "DECISION_STARTED" }, String(status));
  }
  assert.equal(calls, 2);

  await assert.rejects(mcp.decideMcpAuthorization(session(), "APPROVE", "ws-other"), { code: "INVALID_WORKSPACE" });
  await assert.rejects(mcp.decideMcpAuthorization(session({ pending: mcp.parsePendingAuthorization(pending({ expires_at: new Date(Date.now() - 1).toISOString() })) }), "DENY"), { code: "EXPIRED" });
  const changed = session();
  auth.saveAccessToken("other-account-access");
  await assert.rejects(mcp.decideMcpAuthorization(changed, "DENY"), { code: "AUTH_CHANGED" });
  assert.equal(calls, 2);
});

test("성공 이동은 server redirect의 HTTPS 또는 loopback HTTP만 허용한다", () => {
  for (const safe of ["https://client.example/callback?code=x", "http://localhost:5555/callback", "http://127.0.0.1:43123/callback", "http://[::1]:3000/callback"]) {
    assert.equal(mcp.safeOAuthRedirect(safe), safe);
  }
  for (const unsafe of ["javascript:alert(1)", "data:text/html,x", "http://client.example/callback", "https://user:pass@client.example/callback", " /relative"]) {
    assert.throws(() => mcp.safeOAuthRedirect(unsafe), { code: "UNSAFE_REDIRECT" });
  }
});

test("실제 consent view는 server pending 값만 React text로 렌더하고 선택·버튼 클릭만 전달한다", () => {
  const source = readFileSync(new URL("../src/features/mcp-authorization/ui/McpAuthorizationPage.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS }
  });
  const exports = {};
  const element = (type, props) => ({ type, props });
  const modules = {
    react: { useEffect() {}, useRef: (current) => ({ current }), useState: (initial) => [initial, () => {}] },
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "next/navigation": { useRouter: () => ({ replace() {} }) },
    "next-intl": {
      useFormatter: () => ({ dateTime: () => "server expiry" }),
      useTranslations: () => (key) => ({ "scopes.read": "Read scope", "roles.OWNER": "Owner" })[key] ?? key
    },
    "@/shared/lib/apiErrors": { LoginRequiredError: class extends Error {} },
    "@/shared/lib/authSessionStorage": {},
    "@/shared/ui/auth/AuthControls": { AuthError: ({ children }) => element("error", { children }) },
    "@/shared/ui/auth/AuthScreen": { AuthScreen: ({ title, children }) => element("screen", { children: [title, children] }) },
    "../api/mcpAuthorization": mcp,
    "./McpAuthorizationPage.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) }
  };
  runInNewContext(outputText, { exports, require: (name) => modules[name], window: globalThis.window });
  const actions = [];
  const tree = exports.McpAuthorizationConsent({
    busy: false,
    onApprove: () => actions.push("approve"),
    onDeny: () => actions.push("deny"),
    onSelectWorkspace: (id) => actions.push(id),
    pending: mcp.parsePendingAuthorization(pending()),
    selectedWorkspaceId: ""
  });
  const nodes = [];
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") { nodes.push(String(node)); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    nodes.push(node);
    walk(node.props?.children);
  };
  walk(tree);
  const text = nodes.filter((node) => typeof node === "string").join(" ");
  assert.match(text, /Server Client/);
  assert.match(text, /Server Workspace/);
  assert.match(text, /127\.0\.0\.1/);
  assert.match(text, /Read scope/);
  assert.doesNotMatch(text, /attacker|query-client/);
  assert.deepEqual(actions, []);

  const radio = nodes.find((node) => node?.type === "input");
  radio.props.onChange();
  const buttons = nodes.filter((node) => node?.type === "button");
  buttons.find((button) => button.props.type === "button").props.onClick();
  const form = nodes.find((node) => node?.type === "form");
  form.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(actions, ["ws-server", "deny", "approve"]);

  const fallbackTree = exports.McpAuthorizationConsent({
    busy: false,
    onApprove() {}, onDeny() {}, onSelectWorkspace() {}, selectedWorkspaceId: "",
    pending: mcp.parsePendingAuthorization(pending({ client_name: null, client_id: "server-client-id" }))
  });
  nodes.length = 0;
  walk(fallbackTree);
  assert.match(nodes.filter((node) => typeof node === "string").join(" "), /server-client-id/);

  const emptyTree = exports.McpAuthorizationConsent({
    busy: false,
    onApprove() {}, onDeny() {}, onSelectWorkspace() {}, selectedWorkspaceId: "",
    pending: mcp.parsePendingAuthorization(pending({ workspaces: [] }))
  });
  nodes.length = 0;
  walk(emptyTree);
  const emptyButtons = nodes.filter((node) => node?.type === "button");
  assert.equal(emptyButtons.find((button) => button.props.type === "button").props.disabled, false);
  assert.equal(emptyButtons.find((button) => button.props.type === "submit").props.disabled, true);

  const scopedPending = mcp.parsePendingAuthorization(pending({
    scopes: ["read", "write_propose", "wiki_write"],
    workspaces: [
      { workspace_id: "ws-read", workspace_name: "Read Only", role: "MEMBER", policy_generation: 1, scopes: ["read"] },
      { workspace_id: "ws-all", workspace_name: "Full", role: "OWNER", policy_generation: 1, scopes: ["read", "write_propose", "wiki_write"] }
    ]
  }));
  const renderText = (selectedWorkspaceId) => {
    nodes.length = 0;
    walk(exports.McpAuthorizationConsent({ busy: false, onApprove() {}, onDeny() {}, onSelectWorkspace() {}, selectedWorkspaceId, pending: scopedPending }));
    return nodes.filter((node) => typeof node === "string").join(" | ");
  };
  const grantedText = (text) => text.split("grantedScopesLabel | ")[1]?.split(" | ")[0];

  const unselected = renderText("");
  assert.doesNotMatch(unselected, /grantedScopesLabel|scopesReduced/);
  const readOnly = renderText("ws-read");
  assert.equal(grantedText(readOnly), "Read scope");
  assert.match(readOnly, /scopesReduced/);
  const full = renderText("ws-all");
  assert.equal(grantedText(full), "Read scope, scopes.write_propose, scopes.wiki_write");
  assert.doesNotMatch(full, /scopesReduced/);
});
