import assert from "node:assert/strict";
import test from "node:test";
import {
  collectSelectableDocumentIds,
  isAllSelected,
  isMarkdownTreeItem,
  isSelectableTreeItem,
  toggleDocumentIds
} from "../src/widgets/document-sidebar/model/wikiIngestSelection.ts";

function file(id, label, mimeType) {
  return { id, label, type: "file", documentId: `doc-${id}`, mimeType };
}

function folder(id, children) {
  return { id, label: `folder ${id}`, type: "folder", children };
}

const tree = [
  folder("a", [
    file("1", "note.md", "text/markdown"),
    folder("b", [file("2", "plan.md", "text/markdown"), file("3", "paper.pdf", "application/pdf")]),
    file("4", "memo.txt", "text/plain")
  ])
];
const eligible = new Set(["doc-1", "doc-2", "doc-3", "doc-4"]);

test("마크다운 판정은 mimeType 또는 .md 확장자를 본다", () => {
  assert.equal(isMarkdownTreeItem(file("1", "note", "text/markdown")), true);
  assert.equal(isMarkdownTreeItem(file("2", "note.md", undefined)), true);
  assert.equal(isMarkdownTreeItem(file("3", "paper.pdf", "application/pdf")), false);
  assert.equal(isMarkdownTreeItem(file("4", "memo.txt", "text/plain")), false);
});

test("PDF/TXT 문서와 폴더는 선택할 수 없다", () => {
  assert.equal(isSelectableTreeItem(file("1", "note.md", "text/markdown"), eligible), true);
  assert.equal(isSelectableTreeItem(file("3", "paper.pdf", "application/pdf"), eligible), false);
  assert.equal(isSelectableTreeItem(file("4", "memo.txt", "text/plain"), eligible), false);
  assert.equal(isSelectableTreeItem(folder("a", []), eligible), false);
});

test("이미 반영됐거나 처리 중인 문서는 마크다운이어도 선택할 수 없다", () => {
  assert.equal(isSelectableTreeItem(file("1", "note.md", "text/markdown"), new Set()), false);
});

test("폴더는 하위의 선택 가능한 마크다운 문서만 모은다", () => {
  assert.deepEqual(collectSelectableDocumentIds(tree, eligible), ["doc-1", "doc-2"]);
  assert.deepEqual(collectSelectableDocumentIds(tree, new Set(["doc-2"])), ["doc-2"]);
});

test("폴더 체크는 하위 문서를 모두 선택하고, 다시 누르면 모두 해제한다", () => {
  const ids = collectSelectableDocumentIds(tree, eligible);
  const selected = toggleDocumentIds(new Set(), ids);
  assert.deepEqual([...selected], ["doc-1", "doc-2"]);
  assert.equal(isAllSelected(selected, ids), true);

  const cleared = toggleDocumentIds(selected, ids);
  assert.equal(cleared.size, 0);
});

test("일부만 선택된 폴더는 체크 상태가 아니며 누르면 나머지를 채운다", () => {
  const ids = ["doc-1", "doc-2"];
  const partial = new Set(["doc-1"]);
  assert.equal(isAllSelected(partial, ids), false);
  assert.deepEqual([...toggleDocumentIds(partial, ids)], ["doc-1", "doc-2"]);
});

test("선택 가능한 문서가 없는 폴더는 체크 상태가 될 수 없다", () => {
  assert.equal(isAllSelected(new Set(), []), false);
});

test("toggleDocumentIds는 원본 Set을 바꾸지 않는다", () => {
  const original = new Set(["doc-1"]);
  toggleDocumentIds(original, ["doc-2"]);
  assert.deepEqual([...original], ["doc-1"]);
});
