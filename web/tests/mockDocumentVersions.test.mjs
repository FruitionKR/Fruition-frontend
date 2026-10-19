import assert from "node:assert/strict";
import test from "node:test";
import { createRouter, issueAccessToken, listen } from "../mock/lib/http.mjs";
import { state } from "../mock/state.mjs";
import { registerDocumentRoutes } from "../mock/routes/documents.mjs";

/** mock 버전 목록이 document 계약(merge_status·source·operation_id)대로 버전 메타를 돌려주는지 확인한다. */
async function startMock(t) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const userId = `user_ver_${suffix}`;
  const workspaceId = `ws_ver_${suffix}`;
  const documentId = `doc_ver_${suffix}`;
  const markdown = "# 메모\n\n첫 줄\n둘째 줄\n셋째 줄\n넷째 줄\n";
  state.users.push({ id: userId });
  state.workspaces.push({ id: workspaceId, name: "versions" });
  state.members.push({ workspace_id: workspaceId, user_id: userId, role: "OWNER" });
  state.documents.push({
    id: documentId, workspace_id: workspaceId, filename: "메모.md", mime_type: "text/markdown", status: "uploaded",
    document_role: "EDITABLE", markdown, owner_user_id: userId, permission: null, folder_id: null,
    current_version: 1, edit_revision: 1, versions: [{ version: 1, content_hash: "h1", created_by: userId, created_at: new Date().toISOString(), markdown }]
  });
  const router = createRouter(state);
  registerDocumentRoutes(router);
  t.mock.method(console, "log", () => {});
  const server = await listen(router, 0);
  t.after(() => server.close());
  const token = issueAccessToken(state, userId);
  const base = `http://localhost:${server.address().port}/api/workspaces/${workspaceId}/documents/${documentId}`;
  const save = async (body) => {
    const form = new FormData();
    // 프론트처럼 본문은 Blob으로 보낸다(문자열 필드는 CRLF로 바뀐다).
    for (const [key, value] of Object.entries(body)) {
      if (key === "markdown") form.append(key, new Blob([value], { type: "text/markdown" }), "content.md");
      else form.append(key, String(value));
    }
    const response = await fetch(`${base}/content`, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: form });
    return response.json();
  };
  const versions = async () => (await (await fetch(`${base}/versions`, { headers: { Authorization: `Bearer ${token}` } })).json()).versions;
  return { save, versions, markdown };
}

test("Agent 적용 저장은 버전에 operation_id(apply_operation_id)와 source agent를 남긴다", async (t) => {
  const { save, versions, markdown } = await startMock(t);
  await save({ markdown: markdown.replace("첫 줄", "첫 줄!"), base_revision: 1, source: "agent", apply_operation_id: "apply_test_1" });
  const [latest] = await versions();
  assert.equal(latest.version, 2);
  assert.equal(latest.source, "agent");
  assert.equal(latest.operation_id, "apply_test_1");
  assert.equal(latest.merge_status, null);
});

test("오래된 기준으로 저장하면 버전 목록에 merged·overwritten이 남는다", async (t) => {
  const { save, versions, markdown } = await startMock(t);
  await save({ markdown: markdown.replace("첫 줄", "첫 줄 A"), base_revision: 1 });
  await save({ markdown: markdown.replace("넷째 줄", "넷째 줄 B"), base_revision: 1 });
  await save({ markdown: markdown.replace("첫 줄", "첫 줄 C"), base_revision: 1 });
  const list = await versions();
  assert.deepEqual(list.map((item) => [item.version, item.merge_status, item.source, item.operation_id]), [
    [4, "overwritten", "user", null],
    [3, "merged", "user", null],
    [2, null, "user", null],
    [1, null, null, null]
  ]);
});
