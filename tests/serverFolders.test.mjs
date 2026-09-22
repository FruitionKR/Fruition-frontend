import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { projectsFromServerTree, ROOT_DOCUMENTS_PROJECT_ID } = await import("../src/entities/tree/lib/serverTree.ts");
const { createFolder, renameFolder, moveFolder, moveDocument, deleteFolder } = await import("../src/entities/tree/api/folders.ts");
const { folderNames, serverFolderId } = await import("../src/entities/tree/lib/names.ts");
const folder = (id, name, children = []) => ({ type: "folder", id, name, current_version: 7, children });
const doc = (id, name) => ({ type: "document", id, name, current_version: 3, document: { id, filename: name, mime_type: "text/markdown", status: "uploaded" } });

test("서버 트리는 루트와 중첩 폴더 위치 및 이름 정렬을 복원한다", () => {
  const projects = projectsFromServerTree([doc("root", "Root.md"), folder("b", "B", [doc("2", "z.md"), folder("nested", "A", [doc("3", "Report.md")]), doc("1", "a.md")]), folder("a", "A")]);
  assert.deepEqual(projects.map(p => p.title), ["업로드 문서", "A", "B"]);
  assert.equal(projects[0].items[0].documentId, "root");
  assert.deepEqual(projects[2].items.map(i => i.label), ["A", "a.md", "z.md"]);
  assert.equal(projects[2].items[0].children[0].documentId, "3");
  assert.equal(serverFolderId(projects, { projectId: ROOT_DOCUMENTS_PROJECT_ID, folderId: null }), null);
  assert.equal(serverFolderId(projects, { projectId: "b", folderId: null }), "b");
  assert.equal(serverFolderId(projects, { projectId: "b", folderId: "nested" }), "nested");
});

test("서버에서 이동·삭제한 항목은 로컬 배치로 되돌리지 않으며 진행 중 업로드는 유지한다", () => {
  const old = [{ id: ROOT_DOCUMENTS_PROJECT_ID, folderId: null, title: "업로드 문서", items: [
    { id: "old", documentId: "deleted", label: "deleted.md", type: "file" },
    { id: "upload-pending", label: "pending.md", type: "file", status: "uploading" },
    { id: "upload-done", documentId: "done", label: "done.md", type: "file" }
  ] }];
  const projects = projectsFromServerTree([folder("f", "폴더", [doc("done", "done.md")])], old);
  assert.deepEqual(projects[0].items.map(i => i.id), ["upload-pending"]);
  assert.equal(projects[1].items[0].documentId, "done");
});

test("루트 파일과 실제 폴더는 이름 공간을 공유하고 가상 업로드 그룹명은 제외한다", () => {
  const projects = projectsFromServerTree([doc("d", "Report.md"), folder("f", "폴더")]);
  assert.deepEqual([...folderNames(projects)].sort(), ["report.md", "폴더"]);
  assert.equal(folderNames(projects, undefined, { projectId: ROOT_DOCUMENTS_PROJECT_ID, folderId: null }).has("폴더"), true);
});

function workspace(t) {
  const old = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
  t.after(() => { if (old === undefined) delete globalThis.window; else globalThis.window = old; });
}

test("폴더 생성은 상위 폴더와 멱등 키를 서버로 전송한다", async t => {
  workspace(t);
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/workspaces/ws_test/folders");
    assert.equal(init.method, "POST");
    assert.ok(new Headers(init.headers).get("Idempotency-Key"));
    assert.deepEqual(JSON.parse(init.body), { name: "새 폴더", parent_folder_id: "parent" });
    return Response.json({ id: "created", name: "새 폴더", current_version: 1 });
  });
  assert.equal((await createFolder("새 폴더", "parent")).id, "created");
});

test("폴더 이름변경·이동·삭제와 문서 이동은 최신 트리 버전을 사용한다", async t => {
  workspace(t);
  const writes = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (!init?.method) return Response.json({ items: [folder("f", "폴더", [doc("d", "문서.md")])] });
    assert.ok(new Headers(init.headers).get("Idempotency-Key"));
    writes.push({ path, method: init.method, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  });
  await renameFolder("f", "변경");
  await moveFolder("f", null, 0);
  await moveDocument("d", "other");
  await deleteFolder("f");
  assert.deepEqual(writes.map(w => w.body), [
    { name: "변경", base_version: 7 }, { parent_folder_id: null, position: 0, base_version: 7 },
    { folder_id: "other", base_version: 3 }, { base_version: 7 }
  ]);
  assert.deepEqual(writes.map(w => w.method), ["PATCH", "PATCH", "PATCH", "DELETE"]);
  assert.ok(writes[2].path.endsWith("/documents/d/position"));
});

test("서버 트리에서 사라진 항목은 변경하지 않는다", async t => {
  workspace(t);
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    if (init?.method) writes++;
    return Response.json({ items: [] });
  });
  await assert.rejects(renameFolder("missing", "이름"), /이동되거나 삭제/);
  assert.equal(writes, 0);
});
