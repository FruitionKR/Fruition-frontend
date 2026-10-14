import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const api = await import("../src/features/desktop-sync/api/syncApi.ts");
const { ApiError } = await import("../src/shared/lib/errors.ts");

/** fetch 호출을 기록하고 정해 둔 응답을 차례로 돌려준다. 워크스페이스 선택값(window)은 두지 않는다. */
function recordFetch(t, responses) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push({ path, init });
    const next = responses.shift();
    return typeof next === "function" ? next() : next;
  });
  return calls;
}

const header = (init, name) => new Headers(init?.headers).get(name);

test("문서 상세는 넘겨받은 워크스페이스로 조회하고 버전·본문을 돌려준다", async (t) => {
  const calls = recordFetch(t, [Response.json({
    id: "doc_1", filename: "메모.md", document_role: "EDITABLE", editable: true, status: "completed",
    current_version: 3, edit_revision: 7, updated_at: "2026-10-09T00:00:00Z", markdown: "본문", folder_id: null
  })]);
  const detail = await api.fetchSyncDocument("ws_a", "doc_1");
  assert.equal(calls[0].path, "/api/workspaces/ws_a/documents/doc_1");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(
    { currentVersion: detail.currentVersion, editRevision: detail.editRevision, markdown: detail.markdown, editable: detail.editable },
    { currentVersion: 3, editRevision: 7, markdown: "본문", editable: true }
  );
});

test("본문 저장은 넘겨받은 base_revision과 revision_write_id를 그대로 보낸다", async (t) => {
  const calls = recordFetch(t, [Response.json({ document_id: "doc_1", current_version: 8, updated_at: "2026-10-09T00:00:01Z" })]);
  const result = await api.saveSyncContent("ws_a", "doc_1", { markdown: "새 본문\n", baseRevision: 7, revisionWriteId: "write_1" });
  assert.equal(calls[0].path, "/api/workspaces/ws_a/documents/doc_1/content");
  assert.equal(calls[0].init.method, "PUT");
  const form = calls[0].init.body;
  assert.equal(form.get("base_revision"), "7");
  assert.equal(form.get("revision_write_id"), "write_1");
  assert.equal(await form.get("markdown").text(), "새 본문\n");
  assert.deepEqual(result, { revision: 8, updatedAt: "2026-10-09T00:00:01Z" });
});

test("저장 실패는 서버 code를 담은 ApiError로 던진다", async (t) => {
  recordFetch(t, [Response.json({ error: { code: "DOCUMENT_VERSION_CONFLICT", message: "충돌" } }, { status: 409 })]);
  await assert.rejects(
    api.saveSyncContent("ws_a", "doc_1", { markdown: "x", baseRevision: 1, revisionWriteId: "w" }),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "DOCUMENT_VERSION_CONFLICT"
  );
});

test("파일 업로드는 넘겨받은 Idempotency-Key와 폴더로 보낸다", async (t) => {
  const calls = recordFetch(t, [Response.json({ id: "doc_2", filename: "메모.md" })]);
  const file = new File(["본문"], "메모.md", { type: "text/markdown" });
  const uploaded = await api.uploadSyncFile("ws_a", file, "folder_1", "key_upload");
  assert.equal(calls[0].path, "/api/workspaces/ws_a/documents");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(header(calls[0].init, "Idempotency-Key"), "key_upload");
  assert.equal(calls[0].init.body.get("folder_id"), "folder_1");
  assert.equal(uploaded.id, "doc_2");
});

test("삭제는 버전을 다시 조회하지 않고 보관한 base_version을 보낸다", async (t) => {
  const calls = recordFetch(t, [new Response(null, { status: 204 })]);
  await api.deleteSyncDocument("ws_a", "doc_1", 3, "key_delete");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/workspaces/ws_a/documents/doc_1");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(header(calls[0].init, "Idempotency-Key"), "key_delete");
  assert.deepEqual(JSON.parse(calls[0].init.body), { base_version: 3 });
});

test("이름 변경은 표시 이름과 base_version만 보낸다", async (t) => {
  const calls = recordFetch(t, [Response.json({ id: "doc_1" })]);
  await api.renameSyncDocument("ws_a", "doc_1", "새 이름", 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/workspaces/ws_a/documents/doc_1/rename");
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].init.body), { display_name: "새 이름", base_version: 3 });
});

test("문서·폴더 이동은 보관한 버전과 키로 position 경로에 보낸다", async (t) => {
  const calls = recordFetch(t, [Response.json({}), Response.json({})]);
  await api.moveSyncDocument("ws_a", "doc_1", "folder_2", 3, "key_move_doc");
  await api.moveSyncFolder("ws_a", "folder_1", null, 5, "key_move_folder");
  assert.equal(calls[0].path, "/api/workspaces/ws_a/documents/doc_1/position");
  assert.deepEqual(JSON.parse(calls[0].init.body), { folder_id: "folder_2", base_version: 3 });
  assert.equal(header(calls[0].init, "Idempotency-Key"), "key_move_doc");
  assert.equal(calls[1].path, "/api/workspaces/ws_a/folders/folder_1/position");
  assert.deepEqual(JSON.parse(calls[1].init.body), { parent_folder_id: null, base_version: 5 });
});

test("폴더 생성·이름 변경·삭제는 넘겨받은 키를 쓴다", async (t) => {
  const calls = recordFetch(t, [Response.json({ id: "folder_1", current_version: 1 }), Response.json({}), new Response(null, { status: 204 })]);
  const folder = await api.createSyncFolder("ws_a", "회의록", null, "key_create");
  await api.renameSyncFolder("ws_a", "folder_1", "회의", 1, "key_rename");
  await api.deleteSyncFolder("ws_a", "folder_1", 2, "key_delete");
  assert.equal(folder.id, "folder_1");
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: "회의록", parent_folder_id: null });
  assert.equal(header(calls[0].init, "Idempotency-Key"), "key_create");
  assert.equal(calls[1].path, "/api/workspaces/ws_a/folders/folder_1");
  assert.deepEqual(JSON.parse(calls[1].init.body), { name: "회의", base_version: 1 });
  assert.equal(calls[2].init.method, "DELETE");
  assert.deepEqual(JSON.parse(calls[2].init.body), { base_version: 2 });
});

test("휴지통 조회와 복구는 문서 lifecycle 경로를 쓴다", async (t) => {
  const calls = recordFetch(t, [
    Response.json({ documents: [{ id: "doc_1", filename: "메모.md", current_version: 4 }] }),
    Response.json({ id: "doc_1", current_version: 5, deleted: false })
  ]);
  const trash = await api.fetchSyncTrash("ws_a");
  await api.restoreSyncDocument("ws_a", "doc_1", 4, "key_restore");
  assert.equal(calls[0].path, "/api/workspaces/ws_a/documents/trash");
  assert.equal(trash[0].current_version, 4);
  assert.equal(calls[1].path, "/api/workspaces/ws_a/documents/doc_1/restore");
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), { base_version: 4 });
  assert.equal(header(calls[1].init, "Idempotency-Key"), "key_restore");
});

test("편입과 변환은 각각 ingest·convert-markdown 경로로 요청한다", async (t) => {
  const calls = recordFetch(t, [Response.json({}), Response.json({ id: "doc_md" })]);
  await api.ingestSyncDocument("ws_a", "doc_1");
  const converted = await api.convertSyncDocument("ws_a", "doc_pdf", "key_convert");
  assert.equal(calls[0].path, "/api/workspaces/ws_a/documents/doc_1/ingest");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].path, "/api/workspaces/ws_a/documents/doc_pdf/convert-markdown");
  assert.equal(header(calls[1].init, "Idempotency-Key"), "key_convert");
  assert.equal(converted.id, "doc_md");
});

test("원본 파일은 넘겨받은 워크스페이스의 original 경로에서 받는다", async (t) => {
  const calls = recordFetch(t, [new Response(new Blob(["%PDF"]), { status: 200 })]);
  const blob = await api.fetchSyncOriginal("ws_a", "doc_pdf");
  assert.equal(calls[0].path, "/api/workspaces/ws_a/documents/doc_pdf/original");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(await blob.text(), "%PDF");
});

test("macOS의 NFD 파일명·폴더명은 NFC로 바꿔 보낸다", async (t) => {
  const calls = recordFetch(t, [Response.json({ id: "doc_3" }), Response.json({ id: "f_1" }), Response.json({}), Response.json({})]);
  const nfd = (value) => value.normalize("NFD");
  await api.uploadSyncFile("ws_a", new File(["본문"], nfd("회의록.md"), { type: "text/markdown" }), null, "k1");
  await api.createSyncFolder("ws_a", nfd(" 자료 "), null, "k2");
  await api.renameSyncFolder("ws_a", "f_1", nfd("정리"), 1, "k3");
  await api.renameSyncDocument("ws_a", "doc_3", nfd("결정"), 1);
  assert.equal(calls[0].init.body.get("file").name, "회의록.md".normalize("NFC"));
  assert.equal(JSON.parse(calls[1].init.body).name, "자료".normalize("NFC"));
  assert.equal(JSON.parse(calls[2].init.body).name, "정리".normalize("NFC"));
  assert.equal(JSON.parse(calls[3].init.body).display_name, "결정".normalize("NFC"));
});

test("위키 상태·그래프·페이지는 넘겨받은 워크스페이스로 조회한다", async (t) => {
  const calls = recordFetch(t, [
    Response.json({ last_wiki_change_at: "2026-10-09T01:00:00Z", needs_lint: false }),
    Response.json({ nodes: [{ id: "p_1", title: "개념", page_type: "concept", slug: "p-1", status: "active" }], edges: [] }),
    Response.json({ id: "p_1", title: "개념", markdown: "# 개념" })
  ]);
  assert.equal(await api.fetchSyncWikiChangedAt("ws_a"), "2026-10-09T01:00:00Z");
  assert.equal((await api.fetchSyncWikiGraph("ws_a")).nodes[0].id, "p_1");
  assert.equal((await api.fetchSyncWikiPage("ws_a", "p_1")).markdown, "# 개념");
  assert.deepEqual(calls.map((call) => call.path), [
    "/api/workspaces/ws_a/wiki/maintenance/status",
    "/api/workspaces/ws_a/wiki/graph",
    "/api/workspaces/ws_a/wiki/pages/p_1"
  ]);
});
