import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { indexRemoteTree } = await import("../src/features/desktop-sync/model/remoteTree.ts");

const doc = (id, name, document = {}) => ({
  type: "document", id, name, sort_order: 0, current_version: 2,
  document: { id, filename: name, document_role: "EDITABLE", editable: true, updated_at: `u_${id}`, ...document }
});
const folder = (id, name, children) => ({ type: "folder", id, name, sort_order: 0, current_version: 1, children });

const tree = [
  folder("f_1", "자료", [
    doc("d_pdf", "논문.pdf", { document_role: "ORIGINAL", editable: false }),
    folder("f_2", "회의록", [doc("d_md", "회의.md")])
  ]),
  doc("d_chat", "[채팅] 질문.md", { editable: false })
];

test("폴더 이름을 이어 문서의 상대 경로를 만든다", () => {
  const { files } = indexRemoteTree(tree, new Set());
  assert.deepEqual(files.map((file) => [file.documentId, file.path, file.updatedAt]), [
    ["d_pdf", "자료/논문.pdf", "u_d_pdf"],
    ["d_md", "자료/회의록/회의.md", "u_d_md"],
    ["d_chat", "[채팅] 질문.md", "u_d_chat"]
  ]);
});

test("편집 문서인데 편집할 수 없거나, 저장이 거절된 문서는 읽기 전용이다", () => {
  const { files } = indexRemoteTree(tree, new Set(["d_md"]));
  const readonly = Object.fromEntries(files.map((file) => [file.documentId, file.readonly]));
  assert.deepEqual(readonly, { d_pdf: false, d_md: true, d_chat: true });
});

test("서버가 can_edit을 주면 저장 거절 기록보다 그 값을 따른다", () => {
  const items = [
    doc("d_edit", "편집.md", { can_edit: true, can_delete: false }),
    doc("d_view", "보기.md", { can_edit: false, can_delete: false }),
    doc("d_pdf", "논문.pdf", { document_role: "ORIGINAL", editable: false, can_edit: true, can_delete: false }),
    doc("d_own_pdf", "내 논문.pdf", { document_role: "ORIGINAL", editable: false, can_edit: true, can_delete: true })
  ];
  const { files } = indexRemoteTree(items, new Set(["d_edit"]));
  const flags = Object.fromEntries(files.map((file) => [file.documentId, [file.readonly, file.undeletable]]));
  assert.deepEqual(flags, {
    d_edit: [false, true],
    d_view: [true, true],
    d_pdf: [true, true],
    d_own_pdf: [false, false]
  });
});

test("폴더 경로와 문서별 버전·상위 폴더를 찾을 수 있다", () => {
  const { folders, documents } = indexRemoteTree(tree, new Set());
  assert.deepEqual(folders.get("자료/회의록"), { id: "f_2", currentVersion: 1 });
  assert.deepEqual(documents.get("d_md"), { currentVersion: 2, folderId: "f_2", filename: "회의.md" });
  assert.deepEqual(documents.get("d_chat"), { currentVersion: 2, folderId: null, filename: "[채팅] 질문.md" });
});

test("수정 시각이 없으면 문서 버전으로 변경을 판단한다", () => {
  const { files } = indexRemoteTree([{ type: "document", id: "d_x", name: "x.md", sort_order: 0, current_version: 5 }], new Set());
  assert.equal(files[0].updatedAt, "v5");
});

test("서버가 허용하는 '..'·숨김 폴더나 숨김 파일명의 문서는 트리에서 뺀다", () => {
  // 넣으면 숨김 폴더에 내려받은 뒤 다음 주기에 로컬 목록에서 빠져 delete-remote가 되고, ".."는 연결 폴더 밖에 쓰게 된다.
  const items = [
    folder("f_up", "..", [doc("d_up", "탈출.md")]),
    folder("f_hidden", ".archive", [doc("d_hidden", "숨김.md")]),
    doc("d_dot", ".notes.md"),
    doc("d_ok", "메모.md")
  ];
  const { files, documents } = indexRemoteTree(items, new Set());
  assert.deepEqual(files.map((file) => file.documentId), ["d_ok"]);
  assert.deepEqual([...documents.keys()], ["d_ok"]);
});
