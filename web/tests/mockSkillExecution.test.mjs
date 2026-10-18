import assert from "node:assert/strict";
import test from "node:test";

const { createRouter, listen, issueAccessToken } = await import("../mock/lib/http.mjs");
const { state } = await import("../mock/state.mjs");
const { registerCatalogRoutes } = await import("../mock/routes/catalog.mjs");

const WORKSPACE_ID = "ws_skill_exec";
const USER_ID = "user_skill_exec";
const DOC_ID = "doc_skill_exec";
const MARKDOWN = "# 연구 개요\n\n아동기는 중요한 시기이다.\n\n# 방법\n\n설문을 한다.";

/** mock 스킬 라우트를 띄우고 멤버 토큰으로 호출하는 함수를 돌려준다. */
async function startMock(t) {
  const timestamp = new Date().toISOString();
  if (!state.users.some((user) => user.id === USER_ID)) {
    state.users.push({ id: USER_ID, email: "skill-exec@example.com", display_name: "스킬", provider: "email" });
    state.workspaces.push({ id: WORKSPACE_ID, name: "스킬 실행", created_at: timestamp, updated_at: timestamp });
    state.members.push({ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "OWNER", joined_at: timestamp });
    state.documents.push({ id: DOC_ID, workspace_id: WORKSPACE_ID, filename: "연구.md", document_role: "EDITABLE", markdown: MARKDOWN });
  }
  const token = issueAccessToken(state, USER_ID);
  const router = createRouter(state);
  registerCatalogRoutes(router);
  t.mock.method(console, "log", () => {});
  const server = await listen(router, 0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/workspaces/${WORKSPACE_ID}/skills`;
  return async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
}

const definition = { name: "exec-check", description: "점검", instructions_markdown: "연구 개요만 고친다.", capabilities: ["document-edit"] };

test("mock 게시·수정은 targets·result_mode를 저장하고 allowed_tools를 계산한다", async (t) => {
  const call = await startMock(t);
  const published = await call("POST", "/author/publish", { ...definition, scope_type: "personal", targets: ["selection"], result_mode: "edit" });
  assert.equal(published.status, 201);
  assert.deepEqual(published.body.targets, ["selection"]);
  assert.equal(published.body.result_mode, "edit");
  assert.ok(published.body.allowed_tools.includes("apply_document_edit"));

  // 생략하면 기존 값을 유지하고, []이면 기본값으로 되돌린다.
  const patch = { name: "exec-check", description: "점검", instructions_markdown: "고친 규칙" };
  const kept = (await call("PATCH", `/${published.body.skill_id}`, patch)).body;
  assert.deepEqual(kept.targets, ["selection"]);
  assert.equal(kept.result_mode, "edit");
  // 상세 시트처럼 targets만 보내면 result_mode는 그대로다.
  const targetsOnly = (await call("PATCH", `/${published.body.skill_id}`, { ...patch, targets: ["current_document", "selection"] })).body;
  assert.deepEqual(targetsOnly.targets, ["current_document", "selection"]);
  assert.equal(targetsOnly.result_mode, "edit");
  assert.deepEqual((await call("PATCH", `/${published.body.skill_id}`, { ...patch, targets: [] })).body.targets, ["current_document"]);

  // capability와 맞지 않는 result_mode, 문서 Skill이 아닌데 보낸 targets는 거절한다.
  assert.equal((await call("POST", "/author/publish", { ...definition, name: "exec-bad", scope_type: "personal", result_mode: "create" })).status, 400);
  const folder = { ...definition, name: "exec-folder", scope_type: "personal", capabilities: ["folder-organize"], targets: ["current_document"] };
  assert.equal((await call("POST", "/author/publish", folder)).status, 400);
});

test("mock 테스트 실행은 섹션 변경 전/후를 돌려주고 같은 run_id는 409로 거절한다", async (t) => {
  const call = await startMock(t);
  const result = await call("POST", "/test-run?run_id=skill_test_mock_1", { ...definition, document_id: DOC_ID, target: { type: "selection", start_line: 1, end_line: 3 } });
  assert.equal(result.status, 200);
  assert.equal(result.body.run_id, "skill_test_mock_1");
  assert.equal(result.body.status, "completed");
  assert.equal(result.body.changes[0].section, "연구 개요");
  assert.deepEqual(result.body.untouched_sections, ["방법"]);
  assert.equal((await call("POST", "/test-run?run_id=skill_test_mock_1", { ...definition, document_id: DOC_ID })).status, 409);

  const outOfRange = await call("POST", "/test-run?run_id=skill_test_mock_2", { ...definition, document_id: DOC_ID, target: { type: "selection", start_line: 1, end_line: 99 } });
  assert.equal(outOfRange.status, 400);
  assert.equal(outOfRange.body.error.code, "INVALID_REQUEST");
  const folder = await call("POST", "/test-run?run_id=skill_test_mock_3", { ...definition, capabilities: ["folder-organize"], document_id: DOC_ID });
  assert.equal(folder.body.error.code, "SKILL_TEST_RUN_UNSUPPORTED");
  const unavailable = await call("POST", "/test-run?run_id=skill_test_mock_4", { ...definition, instructions_markdown: "#테스트불가", document_id: DOC_ID });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error.code, "SKILL_TEST_RUN_UNAVAILABLE");
});
