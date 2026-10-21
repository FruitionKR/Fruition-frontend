import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const {
  folderMarkdownCount, resolveSkillRunTarget, skillRunBlockedMessage, skillRunFolderId, skillRunIntent, skillRunMessage,
  skillRunPreview, skillRunSourceDocumentId, skillRunTargetKind
} =
  await import("../src/widgets/workspace/lib/skillRunTarget.ts");

const version = (capabilities, resultMode, targets) => ({ capabilities, result_mode: resultMode, targets });
const FOLDER_SKILL = version(["folder-organize"]);
const TEMPLATE_SKILL = version(["template"]);
const EDIT_SKILL = version(["document-edit"], "edit");
const CREATE_SKILL = version(["document-create"], "create");
const AUTO_SKILL = version(["document-create", "document-edit"], "auto");

const markdownDoc = { id: "d1", filename: "회의.md", mime_type: "text/markdown", document_role: "EDITABLE", folder_id: "f1" };
const rootDoc = { id: "d3", filename: "메모.md", mime_type: "text/markdown", document_role: "EDITABLE", folder_id: null };
const pdfDoc = { id: "d2", filename: "논문.pdf", mime_type: "application/pdf", document_role: "SOURCE" };
const documents = [markdownDoc, pdfDoc, rootDoc];
const folder = { id: "f1", label: "회의록", type: "folder", children: [{ id: "n1", label: "회의.md", documentId: "d1" }] };
const markdownItem = folder.children[0];
const rootItem = { id: "n3", label: "메모.md", documentId: "d3" };
const pdfItem = { id: "n2", label: "논문.pdf", documentId: "d2" };
const resolve = (skillVersion, item) => resolveSkillRunTarget(skillVersion, item, documents, "demo");

const folderTarget = { kind: "folder", itemId: "f1", folderId: "f1", label: "회의록" };
const documentTarget = { kind: "document", itemId: "n1", documentId: "d1", parentFolderId: "f1", label: "회의.md" };
const rootDocumentTarget = { kind: "document", itemId: "n3", documentId: "d3", parentFolderId: null, label: "메모.md" };

test("스킬 종류·결과 방식으로 하는 일과 고를 대상 종류를 정한다", () => {
  assert.equal(skillRunIntent(FOLDER_SKILL), "organize");
  assert.equal(skillRunIntent(TEMPLATE_SKILL), "template");
  assert.equal(skillRunIntent(CREATE_SKILL), "create");
  assert.equal(skillRunIntent(EDIT_SKILL), "edit");
  assert.equal(skillRunIntent(AUTO_SKILL), "auto");
  assert.equal(skillRunTargetKind(FOLDER_SKILL), "folder");
  assert.equal(skillRunTargetKind(TEMPLATE_SKILL), "folder");
  assert.equal(skillRunTargetKind(CREATE_SKILL), "document-or-folder");
  assert.equal(skillRunTargetKind(EDIT_SKILL), "document");
  assert.equal(skillRunTargetKind(AUTO_SKILL), "document-or-folder");
  // result_mode가 없는 예전 버전은 capability로 판단한다.
  assert.equal(skillRunIntent(version(["document-edit"])), "edit");
  assert.equal(skillRunIntent(version(["document-create"])), "create");
  assert.equal(skillRunIntent(version(["document-create", "document-edit"], null)), "auto");
  assert.equal(skillRunTargetKind(null), "document-or-folder");
});

test("폴더 정리 스킬은 폴더만 고를 수 있고 문서를 고르면 안내한다", () => {
  assert.deepEqual(resolve(FOLDER_SKILL, folder), { status: "ok", target: folderTarget });
  const wrong = resolve(FOLDER_SKILL, markdownItem);
  assert.equal(wrong.status, "invalid");
  assert.equal(wrong.message, "폴더 정리 스킬은 정리할 폴더를 골라 주세요.");
});

test("템플릿 스킬은 새 문서를 둘 폴더만 고른다", () => {
  assert.equal(resolve(TEMPLATE_SKILL, folder).status, "ok");
  const wrong = resolve(TEMPLATE_SKILL, markdownItem);
  assert.equal(wrong.status, "invalid");
  assert.match(wrong.message, /새 문서를 둘 폴더/);
});

test("고칠 문서를 받는 스킬은 Markdown 문서만 고르고 폴더 클릭은 펼치기로 본다", () => {
  assert.deepEqual(resolve(EDIT_SKILL, markdownItem), { status: "ok", target: documentTarget });
  assert.equal(resolve(EDIT_SKILL, folder).status, "ignore");
  const pdf = resolve(EDIT_SKILL, pdfItem);
  assert.equal(pdf.status, "invalid");
  assert.match(pdf.message, /Markdown/);
});

test("새 문서로 만들기 스킬은 요약·변환할 문서나 새 문서를 둘 폴더를 고른다", () => {
  assert.deepEqual(resolve(CREATE_SKILL, folder), { status: "ok", target: folderTarget });
  assert.deepEqual(resolve(CREATE_SKILL, markdownItem), { status: "ok", target: documentTarget });
  assert.deepEqual(resolve(CREATE_SKILL, rootItem), { status: "ok", target: rootDocumentTarget });
  assert.equal(resolve(CREATE_SKILL, pdfItem).status, "invalid");
  // 문서 응답에 folder_id가 없어도 트리에서 찾은 부모 폴더를 쓴다.
  const fromTree = resolveSkillRunTarget(CREATE_SKILL, rootItem, documents, "demo", "f9");
  assert.equal(fromTree.target.parentFolderId, "f9");
  assert.equal(resolveSkillRunTarget(CREATE_SKILL, markdownItem, documents, "demo", null).target.parentFolderId, null);
});

test("상황에 맞게 스킬은 문서와 폴더를 모두 받는다", () => {
  assert.equal(resolve(AUTO_SKILL, markdownItem).target.kind, "document");
  assert.equal(resolve(AUTO_SKILL, folder).target.kind, "folder");
});

test("편집 권한이 없는 문서·폴더와 위키 페이지는 고를 수 없다", () => {
  assert.equal(resolve(EDIT_SKILL, { ...markdownItem, canEdit: false }).status, "invalid");
  assert.equal(resolve(FOLDER_SKILL, { ...folder, canEdit: false }).status, "invalid");
  assert.equal(resolve(AUTO_SKILL, { id: "w1", label: "개념", type: "wiki" }).status, "invalid");
});

test("대상이 '선택한 부분'뿐인 문서 스킬은 사이드바에서 문서를 고르지 못하게 막는다", () => {
  const selectionOnly = version(["document-edit"], "edit", ["selection"]);
  const message = "이 스킬은 문서에서 선택한 부분에만 쓸 수 있어요. 문서에서 부분을 선택한 뒤 채팅에 /demo를 입력하세요.";
  assert.equal(skillRunBlockedMessage(selectionOnly, "demo"), message);
  assert.deepEqual(resolve(selectionOnly, markdownItem), { status: "invalid", message });
  assert.deepEqual(resolve(selectionOnly, folder), { status: "invalid", message });
  // 현재 문서를 포함하거나 targets를 모르면(예전 응답·[]) 막지 않는다. 폴더 정리·템플릿은 targets가 없다.
  assert.equal(skillRunBlockedMessage(version(["document-edit"], "edit", ["current_document", "selection"]), "demo"), null);
  assert.equal(skillRunBlockedMessage(version(["document-edit"], "edit", []), "demo"), null);
  assert.equal(skillRunBlockedMessage(EDIT_SKILL, "demo"), null);
  assert.equal(skillRunBlockedMessage(version(["folder-organize"], null, ["selection"]), "demo"), null);
});

test("실행 요청 문장은 할 일 없이 커맨드만 담는다(AI가 결과 방식·대상으로 실행)", () => {
  assert.equal(skillRunMessage("tidy"), "/tidy");
  assert.equal(skillRunMessage("summary"), "/summary");
});

test("folder_id는 폴더 대상이면 그 폴더, 새 문서로 만들기 스킬의 문서 대상이면 문서가 있는 폴더다", () => {
  assert.equal(skillRunFolderId(FOLDER_SKILL, folderTarget), "f1");
  assert.equal(skillRunFolderId(CREATE_SKILL, folderTarget), "f1");
  assert.equal(skillRunFolderId(CREATE_SKILL, documentTarget), "f1");
  assert.equal(skillRunFolderId(CREATE_SKILL, rootDocumentTarget), null);
  assert.equal(skillRunFolderId(EDIT_SKILL, documentTarget), null);
  assert.equal(skillRunFolderId(AUTO_SKILL, documentTarget), null);
});

const withSource = (skillVersion, requiresSource) => ({ ...skillVersion, requires_source: requiresSource });

test("folderMarkdownCount는 폴더 바로 아래 Markdown 문서만 센다", () => {
  const nested = {
    id: "f2", label: "자료", type: "folder",
    children: [
      { id: "a", label: "회의.md", documentId: "d1" },
      { id: "b", label: "논문.pdf", documentId: "d2" },
      { id: "c", label: "새 노트.md", documentId: "d-unknown", mimeType: "text/markdown" },
      { id: "sub", label: "하위", type: "folder", children: [{ id: "d", label: "메모.md", documentId: "d3" }] },
      { id: "w", label: "개념", type: "wiki" }
    ]
  };
  assert.equal(folderMarkdownCount(nested, documents), 2);
  assert.equal(folderMarkdownCount({ id: "e", label: "빈", type: "folder" }, documents), 0);
});

test("원문이 필요한 스킬을 폴더에 실행하면 폴더 문서 N개를 읽는다고 미리 알리고, 20개를 넘으면 최근 20개만이라고 덧붙인다", () => {
  const create = withSource(CREATE_SKILL, true);
  assert.equal(skillRunPreview(create, folderTarget, 3), "'회의록' 폴더 문서 3개를 읽어 새 문서를 만들어요");
  assert.equal(skillRunPreview(create, folderTarget, 20), "'회의록' 폴더 문서 20개를 읽어 새 문서를 만들어요");
  assert.equal(skillRunPreview(create, folderTarget, 25), "'회의록' 폴더 문서 25개를 읽어 새 문서를 만들어요 (최근 20개만)");
  assert.equal(skillRunPreview(create, folderTarget, 0), "'회의록' 폴더에 읽을 문서가 없어요");
  assert.equal(skillRunPreview(withSource(AUTO_SKILL, true), folderTarget, 2), "'회의록' 폴더 문서 2개를 읽어 새 문서를 만들어요");
});

test("원문이 필요 없는 스킬은 폴더·문서 대상 모두 원문 없이 새 문서를 만든다고 알린다", () => {
  const create = withSource(CREATE_SKILL, false);
  assert.equal(skillRunPreview(create, folderTarget, 5), "'회의록' 폴더에 새 문서를 만들어요 (원문 없이)");
  assert.equal(skillRunPreview(withSource(TEMPLATE_SKILL, false), folderTarget, 5), "'회의록' 폴더에 새 문서를 만들어요 (원문 없이)");
  assert.equal(skillRunPreview(create, documentTarget), "'회의'가 있는 폴더에 새 문서를 만들어요 (원문 없이)");
  assert.equal(skillRunPreview(withSource(CREATE_SKILL, true), documentTarget), "'회의'를 읽어 같은 폴더에 새 문서를 만들어요");
  // Markdown 확장자는 빼고, 받침 있는 한글 이름은 조사를 맞춘다.
  const named = { ...documentTarget, label: "주간 회의록" };
  assert.equal(skillRunPreview(withSource(CREATE_SKILL, true), named), "'주간 회의록'을 읽어 같은 폴더에 새 문서를 만들어요");
  assert.equal(skillRunPreview(create, named), "'주간 회의록'이 있는 폴더에 새 문서를 만들어요 (원문 없이)");
});

test("값을 모르거나(구버전 백엔드) 폴더 정리·고치기·상황에 맞게의 문서 대상이면 미리보기를 만들지 않는다", () => {
  assert.equal(skillRunPreview(CREATE_SKILL, folderTarget, 3), null);
  assert.equal(skillRunPreview(withSource(CREATE_SKILL, null), documentTarget), null);
  assert.equal(skillRunPreview(withSource(FOLDER_SKILL, false), folderTarget, 3), null);
  assert.equal(skillRunPreview(withSource(EDIT_SKILL, true), documentTarget), null);
  assert.equal(skillRunPreview(withSource(AUTO_SKILL, true), documentTarget), null);
});

test("원문이 필요 없는 새 문서로 만들기 스킬에 문서를 고르면 문서를 원문으로 보내지 않고 그 폴더만 쓴다", () => {
  const skip = withSource(CREATE_SKILL, false);
  assert.equal(skillRunSourceDocumentId(skip, documentTarget), null);
  assert.equal(skillRunFolderId(skip, documentTarget), "f1");
  assert.equal(skillRunSourceDocumentId(withSource(CREATE_SKILL, true), documentTarget), "d1");
  // 값을 모르면 예전처럼 보낸다. 상황에 맞게·고치기는 문서를 고칠 수 있어 늘 보낸다. 폴더 대상은 문서가 없다.
  assert.equal(skillRunSourceDocumentId(CREATE_SKILL, documentTarget), "d1");
  assert.equal(skillRunSourceDocumentId(withSource(AUTO_SKILL, false), documentTarget), "d1");
  assert.equal(skillRunSourceDocumentId(withSource(EDIT_SKILL, false), documentTarget), "d1");
  assert.equal(skillRunSourceDocumentId(withSource(CREATE_SKILL, true), folderTarget), null);
});
