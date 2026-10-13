import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const {
  INGEST_UNAVAILABLE_REASON,
  collectFolderMarkdownIds,
  getSelectionState,
  getTreeItemBlockReason,
  isAllSelected,
  isMarkdownTreeItem,
  isSelectableTreeItem,
  toggleDocumentIds
} = await import("../src/widgets/document-sidebar/model/wikiIngestSelection.ts");

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
    file("4", "memo.txt", "text/plain"),
    folder("empty", [])
  ])
];
// 문서 id별 막힌 이유: null이면 선택 가능. 변환 전 PDF(doc-3)는 선택 가능, TXT는 막힘.
const reasons = new Map([
  ["doc-1", null],
  ["doc-2", null],
  ["doc-3", null],
  ["doc-4", "Markdown 문서만 위키에 편입할 수 있어요"]
]);

test("마크다운 판정은 mimeType 또는 .md 확장자를 본다", () => {
  assert.equal(isMarkdownTreeItem(file("1", "note", "text/markdown")), true);
  assert.equal(isMarkdownTreeItem(file("2", "note.md", undefined)), true);
  assert.equal(isMarkdownTreeItem(file("3", "paper.pdf", "application/pdf")), false);
  assert.equal(isMarkdownTreeItem(file("4", "memo.txt", "text/plain")), false);
});

test("파일 행은 문서별 이유를 따르고, 폴더는 행 자체로 선택 대상이 아니다", () => {
  assert.equal(isSelectableTreeItem(file("1", "note.md", "text/markdown"), reasons), true);
  assert.equal(isSelectableTreeItem(file("3", "paper.pdf", "application/pdf"), reasons), true);
  assert.equal(isSelectableTreeItem(file("4", "memo.txt", "text/plain"), reasons), false);
  assert.equal(getTreeItemBlockReason(file("4", "memo.txt", "text/plain"), reasons), "Markdown 문서만 위키에 편입할 수 있어요");
  assert.equal(isSelectableTreeItem(folder("a", []), reasons), false);
  assert.equal(getTreeItemBlockReason(folder("a", []), reasons), null);
});

test("문서 목록에 아직 없는 파일은 고를 수 없다", () => {
  assert.equal(getTreeItemBlockReason(file("9", "new.md", "text/markdown"), reasons), INGEST_UNAVAILABLE_REASON);
  assert.equal(getTreeItemBlockReason({ id: "up", label: "up.md", type: "file" }, reasons), INGEST_UNAVAILABLE_REASON);
});

test("폴더는 하위 폴더까지 선택 가능한 Markdown만 모으고 PDF·TXT는 넣지 않는다", () => {
  assert.deepEqual(collectFolderMarkdownIds(tree[0].children, reasons), ["doc-1", "doc-2"]);
  assert.deepEqual(collectFolderMarkdownIds(tree[0].children, new Map([["doc-2", null]])), ["doc-2"]);
  assert.deepEqual(collectFolderMarkdownIds([], reasons), []);
});

test("폴더 선택 상태는 전부·일부·없음을 checked·mixed·unchecked로 나눈다", () => {
  const ids = ["doc-1", "doc-2"];
  assert.equal(getSelectionState(new Set(), ids), "unchecked");
  assert.equal(getSelectionState(new Set(["doc-1"]), ids), "mixed");
  assert.equal(getSelectionState(new Set(["doc-1", "doc-2", "doc-3"]), ids), "checked");
  assert.equal(getSelectionState(new Set(["doc-1"]), []), "unchecked");
});

test("폴더 체크는 하위 Markdown을 모두 선택하고, 다시 누르면 모두 해제한다", () => {
  const ids = collectFolderMarkdownIds(tree[0].children, reasons);
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
