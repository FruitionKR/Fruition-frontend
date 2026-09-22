import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});
const { folderNames, availableFolderName, availableDocumentName, normalizeTreeName } = await import("../src/entities/tree/lib/names.ts");
const { moveProjectTreeItem } = await import("../src/entities/tree/lib/mutations.ts");
const { renameDocument, uploadDocumentFile, DocumentNameConflictError } = await import("../src/entities/document/api/document.ts");
const projects = [
  { id: "a", title: "자료", items: [{ id: "folder", label: "운영", type: "folder", children: [] }] },
  { id: "b", title: "API", items: [{ id: "file", label: "보고서.md", type: "file" }] }
];

test("폴더명은 동일 부모 안에서만 한글 조합·대소문자·공백을 무시하고 비교한다", () => {
  const names = folderNames(projects, "a");
  assert.equal(names.has(normalizeTreeName(" 운영 ")), false);
  assert.equal(folderNames(projects, undefined, { projectId: "a", folderId: null }).has(normalizeTreeName(" 운영 ")), true);
  assert.equal(names.has(normalizeTreeName("api")), true);
  assert.equal(names.has("자료"), false);
  assert.equal(names.has("보고서.md"), false);
  assert.equal(availableFolderName(projects, "운영"), "운영");
});

test("드래그로 자동 생성하는 묶음은 다른 부모의 같은 이름을 허용한다", () => {
  const tree = [
    { id: "a", title: "새 문서 묶음", items: [{ id: "first", label: "1.md", type: "file" }] },
    { id: "b", title: "다른 폴더", items: [{ id: "second", label: "2.md", type: "file" }] }
  ];
  const moved = moveProjectTreeItem(tree, "a", "first", { projectId: "b", targetId: "second", position: "inside" });
  assert.equal(moved[1].items[0].label, "새 문서 묶음");
});

function selectWorkspace(t) {
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
}

test("문서 이름 변경은 확장자를 보존하고 현재 버전을 보내며 중복 오류를 전달한다", async (t) => {
  selectWorkspace(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push(path);
    if (calls.length === 1) return Response.json({ filename: "old.md", current_version: 7 });
    if (init?.method !== "PATCH") return Response.json({ items: [{ type: "document", id: "doc_test", name: "old.md" }] });
    assert.equal(path, "/api/workspaces/ws_test/documents/doc_test/rename");
    assert.deepEqual(JSON.parse(init.body), { display_name: "보고서", base_version: 7 });
    return Response.json({ error: { code: "DUPLICATE_NAME", message: "같은 파일명이 이미 있습니다." } }, { status: 409 });
  });
  await assert.rejects(renameDocument("doc_test", "보고서.md"), /같은 파일명/);
});

test("새 노트는 같은 폴더의 업로드 중인 항목만 확인해 번호를 붙인다", () => {
  const tree = [{ id: "p", title: "자료", items: [
    { id: "f", label: "폴더", type: "folder", children: [{ id: "1", label: "새 노트.md", type: "file" }] },
    { id: "2", label: "새 노트 (2).MD", type: "file", status: "uploading" }
  ] }];
  assert.equal(availableDocumentName(tree, "새 노트.md", { projectId: "p", folderId: null }), "새 노트.md");
  assert.equal(availableDocumentName(tree, "새 노트.md", { projectId: "p", folderId: "f" }), "새 노트 (2).md");
});

test("같은 파일명은 공백·한글 조합·대소문자 차이가 있어도 업로드하지 않는다", async (t) => {
  selectWorkspace(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push(init?.method ?? "GET");
    return Response.json({ items: [{ type: "document", id: "existing", name: "보고서.md" }] });
  });
  await assert.rejects(uploadDocumentFile(new File([""], " 보고서.MD ")), DocumentNameConflictError);
  assert.deepEqual(calls, ["GET"]);
});

test("동시 업로드의 중복 이름은 한 번만 전송하고 실패 후 예약을 해제한다", async (t) => {
  selectWorkspace(t);
  let posts = 0;
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    if (init?.method !== "POST") return Response.json({ items: [] });
    posts++;
    return Response.json({ error: { message: "업로드 실패" } }, { status: 500 });
  });
  const results = await Promise.allSettled([
    uploadDocumentFile(new File([""], "same.md")),
    uploadDocumentFile(new File([""], "SAME.MD"))
  ]);
  assert.equal(posts, 1);
  assert.equal(results[1].reason instanceof DocumentNameConflictError, true);
  await assert.rejects(uploadDocumentFile(new File([""], "same.md")));
  assert.equal(posts, 2);
});

test("확장자를 생략한 이름 변경도 최종 파일명의 중복을 검사한다", async (t) => {
  selectWorkspace(t);
  let patches = 0;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (init?.method === "PATCH") patches++;
    if (path.endsWith("/doc_test")) return Response.json({ filename: "old.md", current_version: 7 });
    return Response.json({ items: [{ type: "document", id: "doc_test", name: "old.md" }, { type: "document", id: "other", name: "보고서.md" }] });
  });
  await assert.rejects(renameDocument("doc_test", "보고서"), DocumentNameConflictError);
  assert.equal(patches, 0);
});

test("자기 이름은 중복에서 제외하고 확장자가 다른 문서는 허용한다", async (t) => {
  selectWorkspace(t);
  let patches = 0;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (init?.method === "PATCH") { patches++; return new Response(null, { status: 204 }); }
    if (path.endsWith("/doc_test")) return Response.json({ filename: "보고서.md", current_version: 7 });
    return Response.json({ items: [
      { type: "document", id: "doc_test", name: "보고서.md" },
      { type: "document", id: "pdf", name: "보고서.pdf" }
    ] });
  });
  await renameDocument("doc_test", "보고서.md");
  assert.equal(patches, 1);
});

test("현재 버전을 얻지 못하면 이름 변경 요청을 보내지 않는다", async (t) => {
  selectWorkspace(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ filename: "old.md" }); });
  await assert.rejects(renameDocument("doc_test", "새 이름.md"));
  assert.equal(calls, 1);
});

const folder = (id, children = []) => ({ type: "folder", id, name: id, current_version: 1, children });
const doc = (id, name) => ({ type: "document", id, name, current_version: 1 });

test("다른 폴더의 같은 파일명은 허용하고 업로드에 대상 폴더를 전달한다", async (t) => {
  selectWorkspace(t);
  let posts = 0;
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    if (init?.method !== "POST") return Response.json({ items: [folder("a", [doc("other", "Report.md")]), folder("b")] });
    posts++;
    assert.equal(init.body.get("folder_id"), "b");
    return Response.json({ id: "new" });
  });
  await uploadDocumentFile(new File([""], "report.md"), "b");
  assert.equal(posts, 1);
  await assert.rejects(uploadDocumentFile(new File([""], "report.md"), "a"), DocumentNameConflictError);
});

test("이름 변경은 서버의 실제 부모를 기준으로 검사한다", async (t) => {
  selectWorkspace(t);
  let patches = 0;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (init?.method === "PATCH") { patches++; return new Response(null, { status: 204 }); }
    if (path.endsWith("/self")) return Response.json({ filename: "old.md", current_version: 2 });
    return Response.json({ items: [folder("a", [doc("other", "Report.md")]), folder("b", [doc("self", "old.md")])] });
  });
  await renameDocument("self", "report.md");
  assert.equal(patches, 1);
});

test("파일과 폴더는 같은 부모에서 이름 공간을 공유한다", async (t) => {
  selectWorkspace(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ items: [folder("Report.md")] }));
  await assert.rejects(uploadDocumentFile(new File([""], "report.md")), DocumentNameConflictError);
});

test("다른 폴더의 동시 업로드는 같은 이름이어도 모두 허용한다", async (t) => {
  selectWorkspace(t);
  let posts = 0;
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    if (init?.method !== "POST") return Response.json({ items: [folder("a"), folder("b")] });
    posts++;
    return Response.json({ id: String(posts) });
  });
  await Promise.all([uploadDocumentFile(new File([""], "same.md"), "a"), uploadDocumentFile(new File([""], "SAME.md"), "b")]);
  assert.equal(posts, 2);
});

test("없는 폴더나 트리 조회 실패 시 업로드하지 않는다", async (t) => {
  selectWorkspace(t);
  let posts = 0;
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    if (init?.method === "POST") posts++;
    return Response.json({ items: [] });
  });
  await assert.rejects(uploadDocumentFile(new File([""], "same.md"), "missing"), /폴더를 찾을/);
  assert.equal(posts, 0);
});
