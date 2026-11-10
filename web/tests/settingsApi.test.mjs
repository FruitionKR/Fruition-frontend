import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match.js";

// Node 테스트에서도 앱의 TypeScript 경로 별칭을 같은 소스로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    // 배럴(auth.ts)의 확장자 없는 상대 경로 재수출도 .ts 소스로 해석한다.
    // next.config.mjs가 부르는 next-intl 플러그인(node_modules)의 require는 건드리지 않는다.
    if (specifier.startsWith(".") && !context.parentURL?.includes("/node_modules/") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const { changePassword, updateDisplayName, requestEmailVerification, confirmEmailVerification, changeEmail, fetchSessions, revokeSession } = await import("../src/entities/user/api/auth.ts");
const { uploadWorkspaceIcon, fetchWorkspaceIcon } = await import("../src/entities/workspace/api/workspace.ts");
const { fetchMembers, changeMemberRole, inviteMember, removeMember } = await import("../src/entities/workspace/api/members.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
const { fetchInvitation, acceptInvitation } = await import("../src/entities/workspace/api/invitations.ts");
const { loginWithEmail, exchangeOAuthCode, loginWithMfa, fetchMfaStatus, registerMfa, activateMfa, disableMfa } = await import("../src/entities/user/api/auth.ts");
const { fetchMcpConnections, disconnectMcpConnection } = await import("../src/entities/user/api/mcpConnections.ts");
const { registerSharedTranslate } = await import("../src/shared/i18n/sharedTranslate.ts");
const apiErrors = await import("../src/shared/lib/apiErrors.ts");

test("닉네임 저장은 인증된 PATCH와 서버 프로필 응답을 사용한다", async (t) => {
  saveAccessToken("test-access");
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/auth/me");
    assert.equal(init.method, "PATCH");
    assert.equal(init.headers.get("Authorization"), "Bearer test-access");
    assert.deepEqual(JSON.parse(init.body), { display_name: "새 이름" });
    return Response.json({ id: "user_test", display_name: "새 이름" });
  });
  assert.equal((await updateDisplayName("새 이름")).display_name, "새 이름");
});

test("잘못된 현재 비밀번호는 refresh 없이 서버 오류를 표시한다", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: { code: "INVALID_CREDENTIALS", message: "현재 비밀번호 불일치" } }, { status: 401 });
  });
  await assert.rejects(changePassword("wrong", "new-password"), /현재 비밀번호 불일치/);
  assert.equal(calls, 1);
});

for (const mismatch of [false, true]) {
  test(`만료된 토큰 갱신 후 비밀번호 변경 결과를 처리한다: ${mismatch ? "불일치 오류" : "204 성공"}`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (path, init) => {
      calls++;
      if (calls === 1) return new Response(null, { status: 401 });
      if (calls === 2) {
        assert.equal(path, "/api/auth/refresh");
        return Response.json({ access_token: "refreshed-test-access" });
      }
      assert.equal(path, "/api/auth/me/password");
      assert.equal(init.method, "PUT");
      assert.equal(init.headers.get("Authorization"), "Bearer refreshed-test-access");
      assert.deepEqual(JSON.parse(init.body), { current_password: "current-password", new_password: "new-password" });
      return mismatch
        ? Response.json({ error: { code: "INVALID_CREDENTIALS", message: "현재 비밀번호 불일치" } }, { status: 401 })
        : new Response(null, { status: 204 });
    });
    if (mismatch) await assert.rejects(changePassword("current-password", "new-password"), /현재 비밀번호 불일치/);
    else await changePassword("current-password", "new-password");
    assert.equal(calls, 3);
  });
}

test("멤버 조회·역할 변경·초대·제거 계약과 204 응답을 처리한다", async (t) => {
  const calls = [];
  const member = { user_id: "user_test", role: "MEMBER" };
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method ?? "GET", init.body ? JSON.parse(init.body) : null]);
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json(init.method === "PATCH" ? { ...member, role: "OWNER" } : { members: [member] });
  });
  assert.deepEqual(await fetchMembers("ws_test"), [member]);
  assert.equal((await changeMemberRole("ws_test", "user_test", "OWNER")).role, "OWNER");
  await inviteMember("ws_test", "member@example.test", "MEMBER");
  await removeMember("ws_test", "user_test");
  assert.deepEqual(calls, [
    ["/api/workspaces/ws_test/members", "GET", null],
    ["/api/workspaces/ws_test/members/user_test", "PATCH", { role: "OWNER" }],
    ["/api/workspaces/ws_test/invitations", "POST", { email: "member@example.test", role: "MEMBER" }],
    ["/api/workspaces/ws_test/members/user_test", "DELETE", null]
  ]);
});

test("멤버 권한 거부는 성공으로 처리하지 않는다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "OWNER 권한이 필요합니다." } }, { status: 403 }));
  await assert.rejects(changeMemberRole("ws_test", "user_test", "OWNER"), /OWNER 권한/);
  await assert.rejects(removeMember("ws_test", "user_test"), /OWNER 권한/);
});

test("초대 확인은 공개 조회, 수락은 인증 요청으로 처리한다", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method ?? "GET", init.headers?.get("Authorization")]);
    return Response.json({ workspace_id: "ws_invited" });
  });
  saveAccessToken("invitation-test-access");
  await fetchInvitation("test/token");
  assert.equal((await acceptInvitation("test/token")).workspace_id, "ws_invited");
  assert.deepEqual(calls, [
    ["/api/invitations/test%2Ftoken", "GET", undefined],
    ["/api/invitations/test%2Ftoken/accept", "POST", "Bearer invitation-test-access"]
  ]);
});

test("초대 화면의 수락은 다른 탭에서 로그인한 현재 쿠키의 계정을 사용한다", async (t) => {
  const auth = await import("../src/shared/lib/authSessionStorage.ts");
  const workspaceAccess = await import("../src/shared/lib/workspaceAccess.ts");
  // 이 탭에서 내보내졌던 워크스페이스에 다시 초대받은 경우다. 수락하면 접근 불가 기록을 지운다.
  workspaceAccess.markWorkspaceGone("invited-workspace");
  t.after(() => workspaceAccess.resetWorkspaceGone());
  const originalWindow = globalThis.window;
  const selected = [];
  const navigated = [];
  globalThis.window = { localStorage: { removeItem() {}, setItem: (...args) => selected.push(args) }, location: { assign: (path) => navigated.push(path) } };
  t.after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });
  const queryClient = new QueryClient();
  queryClient.setQueryData(["me"], { id: "previous-user" });
  saveAccessToken("previous-user-access");
  const requests = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    const bearer = init.headers?.get("Authorization") ?? null;
    requests.push([path, bearer]);
    if (path === "/api/auth/refresh") return Response.json({ access_token: "invited-user-access" });
    if (bearer === "Bearer previous-user-access") return Response.json({ error: { message: "초대 이메일 불일치" } }, { status: 403 });
    if (!bearer) return new Response(null, { status: 401 });
    return Response.json({ workspace_id: "invited-workspace" });
  });
  await assert.rejects(acceptInvitation("invite-token"), /초대 이메일 불일치/);

  // 실제 화면의 수락 버튼을 실행하고 인증 API까지 연결한다.
  const source = readFileSync(new URL("../src/views/invitation/ui/InvitationPage.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  const element = (type, props) => ({ type, props });
  const modules = {
    react: { useState: (initial) => [initial, () => {}] },
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "@tanstack/react-query": { useQuery: () => ({ data: { email: "invited@example.test" } }), useQueryClient: () => queryClient },
    "next-intl": { useTranslations: () => (key) => key, useFormatter: () => ({ dateTime: () => "" }) },
    "@/shared/lib/authSessionStorage": auth,
    "@/entities/workspace/api/invitations": { acceptInvitation, fetchInvitation },
    "@/entities/user": { useSignOut: () => ({ signOut: async () => {} }) },
    "@/shared/lib/apiErrors": {},
    "@/shared/lib/workspaceAccess": workspaceAccess,
    "@/views/workspaces/ui/WorkspacesPage.module.css": { default: {} }
  };
  runInNewContext(outputText, { exports, require: (name) => modules[name], window: globalThis.window });
  function findButton(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "button") return node;
    return [node.props?.children].flat(Infinity).map(findButton).find(Boolean);
  }
  findButton(exports.default({ token: "invite-token" })).props.onClick();
  await new Promise(setImmediate);
  assert.equal(auth.getAccessToken(), "invited-user-access");
  assert.equal(queryClient.getQueryCache().getAll().length, 0);
  assert.deepEqual(selected, [["fruition.workspace_id", "invited-workspace"]]);
  assert.deepEqual(navigated, ["/home"]);
  assert.equal(workspaceAccess.isWorkspaceGone("invited-workspace"), false);
  assert.deepEqual(requests, [
    ["/api/invitations/invite-token/accept", "Bearer previous-user-access"],
    ["/api/invitations/invite-token/accept", null],
    ["/api/auth/refresh", null],
    ["/api/invitations/invite-token/accept", "Bearer invited-user-access"]
  ]);
});

test("이메일 변경은 전용 목적의 인증번호를 확인한 뒤 인증된 PUT으로 확정한다", async (t) => {
  saveAccessToken("email-test-access");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method, JSON.parse(init.body)]);
    if (path === "/api/auth/email-verifications") return Response.json({ verification_id: "verify_test", retry_after: 60, expires_in: 300 });
    if (path.endsWith("/confirm")) return Response.json({ verification_token: "verified-test-token", expires_in: 300 });
    assert.equal(init.headers.get("Authorization"), "Bearer email-test-access");
    return Response.json({ id: "user_test", email: "new@example.test" });
  });
  const sent = await requestEmailVerification("new@example.test", "email_change");
  const confirmed = await confirmEmailVerification(sent.verification_id, "123456");
  const body = { new_email: "new@example.test", verification_token: confirmed.verification_token, current_password: "current-password" };
  assert.equal((await changeEmail(body)).email, "new@example.test");
  assert.deepEqual(calls, [
    ["/api/auth/email-verifications", "POST", { email: "new@example.test", purpose: "email_change" }],
    ["/api/auth/email-verifications/verify_test/confirm", "POST", { code: "123456" }],
    ["/api/auth/me/email", "PUT", { new_email: "new@example.test", verification_token: "verified-test-token", current_password: "current-password" }]
  ]);
});

test("이메일 중복과 만료된 인증은 성공으로 처리하지 않는다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "이미 사용 중인 이메일입니다." } }, { status: 409 }));
  await assert.rejects(changeEmail({ new_email: "used@example.test", verification_token: "test-token" }), /이미 사용 중/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "인증이 만료되었습니다." } }, { status: 400 }));
  await assert.rejects(confirmEmailVerification("expired", "123456"), /인증이 만료/);
});

test("세션 목록은 현재 기기와 알 수 없는 기기를 보존하고 숫자 ID로 폐기한다", async (t) => {
  const sessions = [{ session_id: 42, user_agent: null, current: true, created_at: "2026-09-08T00:00:00Z", expires_at: "2026-09-22T00:00:00Z" }];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (init.method === "DELETE") {
      assert.equal(path, "/api/auth/me/sessions/42");
      return new Response(null, { status: 204 });
    }
    assert.equal(path, "/api/auth/me/sessions");
    return Response.json({ sessions });
  });
  assert.deepEqual(await fetchSessions(), sessions);
  await revokeSession(42);
});

test("아이콘 multipart 업로드·인증 이미지 조회 계약을 따른다", async (t) => {
  saveAccessToken("icon-test-access");
  const file = new File([new Uint8Array([137, 80, 78, 71])], "icon.png", { type: "image/png" });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(init.headers.get("Authorization"), "Bearer icon-test-access");
    calls.push([path, init.method ?? "GET"]);
    if (init.body instanceof FormData) {
      assert.equal(init.headers.has("Content-Type"), false);
      assert.equal(init.body.get("file").name, "icon.png");
      assert.equal(init.body.get("file").size, file.size);
    } else {
      return new Response(file, { headers: { "Content-Type": "image/png" } });
    }
    return Response.json({ id: "ws_test", icon_emoji: null, icon_url: null });
  });
  await uploadWorkspaceIcon("ws_test", file);
  const blob = await fetchWorkspaceIcon("ws_test");
  assert.equal(blob.type, "image/png");
  assert.equal(blob.size, file.size);
  assert.deepEqual(calls, [
    ["/api/workspaces/ws_test/icon/image", "PUT"],
    ["/api/workspaces/ws_test/icon/image", "GET"]
  ]);
});

test("아이콘 조회 실패와 이미 폐기된 세션은 오류로 처리한다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "찾을 수 없습니다." } }, { status: 404 }));
  await assert.rejects(fetchWorkspaceIcon("missing"), /찾을 수 없습니다/);
  await assert.rejects(revokeSession(42), /찾을 수 없습니다/);
});

test("아이콘 프록시는 document-svc 기본 경로보다 먼저 access-svc로 전달한다", async () => {
  const { default: config } = await import("../next.config.mjs");
  const rules = await config.rewrites();
  const iconIndex = rules.findIndex((rule) => rule.source === "/api/workspaces/:wid/icon/:path*");
  const defaultIndex = rules.findIndex((rule) => rule.source === "/api/:path*");
  assert.ok(iconIndex >= 0 && iconIndex < defaultIndex);
  assert.equal(rules[iconIndex].destination, `${process.env.ACCESS_URL || "http://localhost:8081"}/api/workspaces/:wid/icon/:path*`);
});

test("MCP 연결 목록은 페이지·Bearer·nullable DTO를 그대로 처리한다", async (t) => {
  saveAccessToken("mcp-test-access");
  const connection = {
    grant_id: "grant_test",
    workspace_id: "workspace_test",
    client_id: "client_test",
    scopes: ["read", "write_propose"],
    status: "ACTIVE",
    revocation_reason: null,
    created_at: "2026-11-08T00:00:00Z",
    revoked_at: null
  };
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/mcp/connections?page=2&size=20");
    assert.equal(init.headers.get("Authorization"), "Bearer mcp-test-access");
    return Response.json({ connections: [connection], page: 2, size: 20, has_next: false });
  });
  const result = await fetchMcpConnections(2);
  assert.deepEqual(result, { connections: [connection], page: 2, size: 20, has_next: false });
  assert.equal("last_used" in result.connections[0], false);
});

test("MCP 연결 해제는 grant_id를 인코딩하고 204·404·5xx를 구분한다", async (t) => {
  let call = 0;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    call++;
    assert.equal(init.method, "DELETE");
    assert.equal(path, "/api/mcp/connections/grant%2Fwith%20space");
    if (call === 1) return new Response(null, { status: 204 });
    if (call === 2) return Response.json({ error: { message: "연결 없음" } }, { status: 404 });
    return Response.json({ error: { message: "Access 장애" } }, { status: 503 });
  });
  await disconnectMcpConnection("grant/with space");
  await assert.rejects(disconnectMcpConnection("grant/with space"), /연결 없음/);
  await assert.rejects(disconnectMcpConnection("grant/with space"), /Access 장애/);
});

test("MCP 연결 rewrite는 base·하위 경로만 catch-all보다 먼저 access로 간다", async () => {
  const { default: config } = await import("../next.config.mjs");
  const rules = await config.rewrites();
  const mcpIndex = rules.findIndex((rule) => rule.source === "/api/mcp/connections/:path*");
  const defaultIndex = rules.findIndex((rule) => rule.source === "/api/:path*");
  assert.ok(mcpIndex >= 0 && mcpIndex < defaultIndex);
  assert.equal(rules[mcpIndex].destination, `${process.env.ACCESS_URL || "http://localhost:8081"}/api/mcp/connections/:path*`);
  const match = getPathMatch(rules[mcpIndex].source);
  assert.notEqual(match("/api/mcp/connections"), false);
  assert.notEqual(match("/api/mcp/connections/grant_test"), false);
  assert.equal(match("/api/mcp/tools"), false);
});

test("실제 QueryObserver는 실패한 refetch 결과를 기본으로는 반환하고 throwOnError에서만 거절한다", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  client.setQueryData(["mcp-connections", 0], { connections: [{ grant_id: "old" }] });
  const observer = new QueryObserver(client, {
    queryKey: ["mcp-connections", 0],
    queryFn: async () => { throw new Error("GET failed"); },
    retry: false
  });
  const unsubscribe = observer.subscribe(() => {});
  t.after(unsubscribe);
  const result = await observer.refetch();
  assert.equal(result.status, "error");
  assert.equal(result.data.connections[0].grant_id, "old");
  await assert.rejects(observer.refetch({ throwOnError: true }), /GET failed/);
});

function catalogTranslator(locale, namespace) {
  const settings = JSON.parse(readFileSync(new URL(`../src/shared/i18n/messages/${locale}/settings.json`, import.meta.url), "utf8"));
  const shared = JSON.parse(readFileSync(new URL(`../src/shared/i18n/messages/${locale}/shared.json`, import.meta.url), "utf8"));
  const messages = { settings, shared };
  return (key, values = {}) => {
    const value = `${namespace}.${key}`.split(".").reduce((current, part) => current?.[part], messages);
    assert.equal(typeof value, "string", `missing ${locale} translation: ${namespace}.${key}`);
    return value.replace(/\{(\w+)\}/g, (_, name) => {
      assert.ok(name in values, `missing ${locale} interpolation: ${namespace}.${key}.${name}`);
      return String(values[name]);
    });
  };
}

function loadMcpConnectionsSection(queryClient, queryResult, api = {}, locale = "ko") {
  const source = readFileSync(new URL("../src/features/user-settings/ui/panels/McpConnectionsSection.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  const states = [queryResult.page, null, null, null, null];
  const updates = [];
  const confirmations = [];
  const element = (type, props) => ({ type, props });
  runInNewContext(outputText, {
    exports,
    require: (name) => ({
      "@/shared/ui/modal/useConfirmation": { useConfirmation: () => ({ confirm: async ({ title }) => { confirmations.push(title); return true; }, confirmationDialog: null }) },
      react: { useEffect: () => {}, useState: () => [states.shift(), (value) => updates.push(value)] },
      "react/jsx-runtime": { jsx: element, jsxs: element },
      "next-intl": {
        useTranslations: (namespace) => catalogTranslator(locale, namespace),
        useFormatter: () => ({ dateTime: (value, options) => new Intl.DateTimeFormat(locale, options).format(value) })
      },
      "@tanstack/react-query": { useQuery: () => queryResult, useQueryClient: () => queryClient },
      "@/entities/user": {
        MCP_CONNECTIONS_QUERY_KEY: ["mcp-connections"],
        disconnectMcpConnection: api.disconnect ?? (async () => {}),
        fetchMcpConnections: api.fetch ?? (async () => queryResult.data),
        useMe: () => ({ data: { id: "user-test" }, error: null, isPending: false })
      },
      "../../lib/mcpConnectionRuns": { clearMcpConnectionRuns: () => {} },
      "@/shared/lib/apiErrors": apiErrors,
      "../SettingsModal.module.css": { default: {} },
      "../SettingsSectionHeader": { SettingsSectionHeader: () => null },
      "./ProfilePanel.module.css": { default: {} },
      "./McpConnectionRunsPanel": { McpConnectionRunsPanel: () => null }
    })[name]
  });
  return { tree: exports.McpConnectionsSection(), updates, confirmations };
}

function findButton(node, label) {
  if (!node || typeof node !== "object") return undefined;
  if (node.type === "button" && node.props?.children === label) return node;
  return [node.props?.children].flat(Infinity).map((child) => findButton(child, label)).find(Boolean);
}

test("204 뒤 목록 새로고침이 실패해도 실제 섹션은 모든 MCP 페이지에서 해제된 행을 제거한다", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const target = { grant_id: "grant-old", client_id: "client", workspace_id: "workspace", scopes: [], status: "ACTIVE", created_at: "2026-11-08", revocation_reason: null, revoked_at: null };
  const other = { ...target, grant_id: "grant-keep", status: "USER_DISCONNECTED" };
  client.setQueryData(["mcp-connections", "user-test", 0], { connections: [target, other], page: 0, size: 20, has_next: true });
  client.setQueryData(["mcp-connections", "user-test", 1], { connections: [target, other], page: 1, size: 20, has_next: false });
  client.setQueryData(["mcp-connections", "other-user", 0], { connections: [target], page: 0, size: 20, has_next: false });
  client.setQueryData(["unrelated"], { connections: [target] });
  const { tree, updates } = loadMcpConnectionsSection(client, {
    data: client.getQueryData(["mcp-connections", "user-test", 0]), page: 0, isFetching: false, isPending: false, refetch: async () => ({})
  }, { fetch: async () => { throw new Error("GET failed"); } });
  findButton(tree, "작업 보기").props.onClick();
  findButton(tree, "연결 해제").props.onClick();
  for (let i = 0; i < 4; i += 1) await new Promise(setImmediate);
  assert.deepEqual(client.getQueryData(["mcp-connections", "user-test", 0]).connections.map((row) => row.grant_id), ["grant-keep"]);
  assert.deepEqual(client.getQueryData(["mcp-connections", "user-test", 1]).connections.map((row) => row.grant_id), ["grant-keep"]);
  assert.deepEqual(client.getQueryData(["mcp-connections", "other-user", 0]).connections.map((row) => row.grant_id), ["grant-old"]);
  assert.deepEqual(client.getQueryData(["unrelated"]).connections.map((row) => row.grant_id), ["grant-old"]);
  assert.ok(updates.some((value) => value?.userId === "user-test" && value.connection === target), "captured task locator remains selected after 204");
  assert.match(updates.find((value) => typeof value === "string" && value.includes("해제는 완료")), /해제는 완료했지만 목록을 새로고침하지 못했습니다/);
});

test("MCP 연결 섹션은 실제 한영 카탈로그로 고지·확인 문구를 보간한다", () => {
  const connection = { grant_id: "grant-1", client_id: "Example Client", workspace_id: "workspace", scopes: [], status: "ACTIVE", created_at: "2026-11-08T00:00:00Z", revocation_reason: null, revoked_at: null };
  const result = { data: { connections: [connection], page: 0, size: 20, has_next: false }, page: 0, isFetching: false, isPending: false, refetch: async () => ({}) };
  const korean = loadMcpConnectionsSection(new QueryClient(), result);
  const english = loadMcpConnectionsSection(new QueryClient(), result, {}, "en");
  assert.match(JSON.stringify(korean.tree), /이미 실행 중인 웹 작업은 취소되지 않으므로/);
  assert.match(JSON.stringify(english.tree), /It does not cancel a web task already running/);
  findButton(korean.tree, "연결 해제").props.onClick();
  findButton(english.tree, "Disconnect").props.onClick();
  assert.match(korean.confirmations[0], /Example Client 연결을 해제하시겠습니까/);
  assert.match(english.confirmations[0], /Disconnect Example Client\?/);
});

test("이미 해제된 연결도 실제 작업 보기 동작을 제공하고 자동 취소하지 않는다", () => {
  const connection = { grant_id: "grant-old", client_id: "Example Client", workspace_id: "workspace-old", scopes: [], status: "USER_DISCONNECTED", created_at: "2026-11-08", revocation_reason: "USER_DISCONNECTED", revoked_at: "2026-11-08" };
  const { tree, updates } = loadMcpConnectionsSection(new QueryClient(), {
    data: { connections: [connection], page: 0, size: 20, has_next: false }, page: 0, isFetching: false, isPending: false, refetch: async () => ({})
  });
  assert.equal(findButton(tree, "연결 해제"), undefined);
  findButton(tree, "작업 보기").props.onClick();
  assert.ok(updates.some((value) => value?.userId === "user-test" && value.connection === connection));
});

test("404 disconnect keeps the captured task locator, while 5xx keeps the connection row", async (t) => {
  const target = { grant_id: "grant-target", client_id: "client", workspace_id: "workspace", scopes: [], status: "ACTIVE", created_at: "2026-11-08", revocation_reason: null, revoked_at: null };
  for (const status of [404, 503]) {
    const client = new QueryClient();
    t.after(() => client.clear());
    client.setQueryData(["mcp-connections", "user-test", 0], { connections: [target], page: 0, size: 20, has_next: false });
    const { tree, updates } = loadMcpConnectionsSection(client, {
      data: client.getQueryData(["mcp-connections", "user-test", 0]), page: 0, isFetching: false, isPending: false,
      refetch: async () => ({ data: { connections: [], page: 0, size: 20, has_next: false } })
    }, { disconnect: async () => { throw new apiErrors.ApiError(status === 404 ? "missing" : "unavailable", status); } });
    findButton(tree, "작업 보기").props.onClick();
    findButton(tree, "연결 해제").props.onClick();
    for (let i = 0; i < 4; i += 1) await new Promise(setImmediate);
    assert.ok(updates.some((value) => value?.connection === target), `status ${status} retains the selected locator`);
    assert.equal(client.getQueryData(["mcp-connections", "user-test", 0]).connections.length, status === 404 ? 0 : 1);
  }
});

test("MCP 연결 섹션은 실제 shared 번역기로 영어 네트워크 오류를 표시한다", (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const resultFor = (error) => ({ data: undefined, error, page: 0, isFetching: false, isPending: false, refetch: async () => ({}) });
  const timeout = new Error("request timed out");
  timeout.name = "TimeoutError";
  const failedFetch = new TypeError("Failed to fetch");
  assert.match(JSON.stringify(loadMcpConnectionsSection(client, resultFor(timeout), {}, "en").tree), /The response took too long, so we stopped waiting/);
  assert.match(JSON.stringify(loadMcpConnectionsSection(client, resultFor(failedFetch), {}, "en").tree), /The connection to the server was lost before a response arrived/);
});

test("MCP API bodyless fallback uses the actual shared translation bridge and preserves server messages", async (t) => {
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => null, removeItem() {} } };
  t.after(() => {
    registerSharedTranslate(null);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  registerSharedTranslate(catalogTranslator("en", "shared"));
  let call = 0;
  t.mock.method(globalThis, "fetch", async () => {
    call += 1;
    return call <= 2 || call === 4
      ? new Response(null, { status: 503 })
      : Response.json({ error: { message: "Server-provided localized message" } }, { status: 503 });
  });
  await assert.rejects(fetchMcpConnections(), /We couldn't load your MCP connections/);
  await assert.rejects(disconnectMcpConnection("grant-test"), /We couldn't disconnect this MCP connection/);
  await assert.rejects(fetchMcpConnections(), /Server-provided localized message/);
  registerSharedTranslate(catalogTranslator("ko", "shared"));
  await assert.rejects(disconnectMcpConnection("grant-test"), /MCP 연결을 해제하지 못했습니다/);
});

test("실패한 다음 페이지에서도 실제 섹션은 이전 버튼을 남기고 응답 없는 다음 버튼을 막는다", () => {
  const { tree } = loadMcpConnectionsSection(new QueryClient(), {
    data: undefined, page: 1, isFetching: false, isPending: false, refetch: async () => ({})
  });
  assert.equal(findButton(tree, "이전").props.disabled, false);
  assert.equal(findButton(tree, "다음").props.disabled, true);
});

for (const oauth of [false, true]) {
  test(`${oauth ? "OAuth" : "이메일"} 로그인은 MFA 요구 응답을 유지하고 코드 확인 후 토큰을 받는다`, async (t) => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (path, init) => {
      calls.push([path, JSON.parse(init.body)]);
      return path === "/api/auth/login/mfa"
        ? Response.json({ access_token: "mfa-verified-test-access" })
        : Response.json({ mfa_required: true, mfa_token: "test-challenge" });
    });
    const first = oauth ? await exchangeOAuthCode("test-oauth-code") : await loginWithEmail("mfa@example.test", "test-password");
    assert.equal(first.mfa_required, true);
    assert.equal(first.access_token, undefined);
    assert.equal((await loginWithMfa(first.mfa_token, "RECOVERYTESTCODE")).access_token, "mfa-verified-test-access");
    assert.deepEqual(calls, [
      oauth ? ["/api/auth/oauth/exchange", { code: "test-oauth-code" }] : ["/api/auth/login", { email: "mfa@example.test", password: "test-password" }],
      ["/api/auth/login/mfa", { mfa_token: "test-challenge", code: "RECOVERYTESTCODE" }]
    ]);
  });
}

test("MFA 상태·등록·활성화·복구 코드 해제 계약을 따른다", async (t) => {
  saveAccessToken("mfa-settings-test-access");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(init.headers.get("Authorization"), "Bearer mfa-settings-test-access");
    calls.push([path, init.method ?? "GET", init.body ? JSON.parse(init.body) : null]);
    if (path.endsWith("/activate") || init.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json(init.method === "POST"
      ? { secret: "TESTSECRET", otpauth_uri: "otpauth://totp/test", recovery_codes: ["TESTRECOVERY"] }
      : { enabled: false, activated_at: null, remaining_recovery_codes: 0 });
  });
  assert.equal((await fetchMfaStatus()).enabled, false);
  assert.deepEqual((await registerMfa()).recovery_codes, ["TESTRECOVERY"]);
  await activateMfa("123456");
  await disableMfa("TESTRECOVERY");
  assert.deepEqual(calls, [
    ["/api/auth/me/mfa", "GET", null],
    ["/api/auth/me/mfa", "POST", null],
    ["/api/auth/me/mfa/activate", "POST", { code: "123456" }],
    ["/api/auth/me/mfa", "DELETE", { code: "TESTRECOVERY" }]
  ]);
});

for (const mutate of [activateMfa, disableMfa]) {
  test(`${mutate.name}: 잘못된 MFA 코드는 refresh나 중복 검증 없이 오류를 표시한다`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return Response.json({ error: { code: "INVALID_MFA_CODE", message: "인증 코드가 올바르지 않습니다." } }, { status: 401 });
    });
    await assert.rejects(mutate("000000"), /인증 코드가 올바르지/);
    assert.equal(calls, 1);
  });
}

test("인증 토큰 만료는 갱신하고 이후 잘못된 MFA 코드는 그대로 표시한다", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (path) => {
    calls++;
    if (calls === 1) return new Response(null, { status: 401 });
    if (calls === 2) {
      assert.equal(path, "/api/auth/refresh");
      return Response.json({ access_token: "refreshed-mfa-test-access" });
    }
    return Response.json({ error: { code: "INVALID_MFA_CODE", message: "인증 코드 오류" } }, { status: 401 });
  });
  await assert.rejects(activateMfa("000000"), /인증 코드 오류/);
  assert.equal(calls, 3);
});

for (const [status, code] of [[400, "INVALID_MFA_CHALLENGE"], [401, "INVALID_MFA_CODE"], [429, "MFA_RATE_LIMITED"]]) {
  test(`MFA 로그인 ${code}는 자동 재시도 없이 서버 오류를 전달한다`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return Response.json({ error: { code, message: code } }, { status });
    });
    await assert.rejects(loginWithMfa("test-challenge", "000000"), new RegExp(code));
    assert.equal(calls, 1);
  });
}

test("스킬 삭제는 인증된 DELETE를 보내고 빈 204 응답을 처리한다", async (t) => {
  const { deleteSkill } = await import("../src/entities/skill/api/skill.ts");
  saveAccessToken("test-access");
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/workspaces/ws_test/skills/skill_test");
    assert.equal(init.method, "DELETE");
    assert.equal(init.headers.get("Authorization"), "Bearer test-access");
    return new Response(null, { status: 204 });
  });
  await deleteSkill("ws_test", "skill_test");
});

test("스킬 삭제 권한 거부를 성공으로 처리하지 않는다", async (t) => {
  const { deleteSkill } = await import("../src/entities/skill/api/skill.ts");
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { error: { message: "스킬이 없거나 삭제 권한이 없습니다." } }, { status: 404 }
  ));
  await assert.rejects(deleteSkill("ws_test", "skill_test"), /삭제 권한/);
});

test("베타 지급 상태는 로그인 계정으로 조회하고 지급액을 그대로 반환한다", async (t) => {
  const { fetchBetaCredit } = await import("../src/entities/user/api/auth.ts");
  saveAccessToken("test-access");
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/auth/me/beta-credit");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.get("Authorization"), "Bearer test-access");
    return Response.json({ status: "granted", amount_krw_milli: 7000000 });
  });
  assert.deepEqual(await fetchBetaCredit(), { status: "granted", amount_krw_milli: 7000000 });
});
