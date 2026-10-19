import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { resolveSkillRunTarget, skillRunMessage, skillRunTargetKind, treeItemPath } =
  await import("../src/widgets/workspace/lib/skillRunTarget.ts");

const version = (capabilities, resultMode) => ({ capabilities, result_mode: resultMode });
const FOLDER_SKILL = version(["folder-organize"]);
const EDIT_SKILL = version(["document-edit"], "edit");
const CREATE_SKILL = version(["document-create"], "create");
const AUTO_SKILL = version(["document-create", "document-edit"], "auto");

const markdownDoc = { id: "d1", filename: "회의.md", mime_type: "text/markdown", document_role: "EDITABLE" };
const pdfDoc = { id: "d2", filename: "논문.pdf", mime_type: "application/pdf", document_role: "SOURCE" };
const documents = [markdownDoc, pdfDoc];
const folder = { id: "f1", label: "회의록", type: "folder", children: [{ id: "n1", label: "회의.md", documentId: "d1" }] };
const markdownItem = folder.children[0];
const pdfItem = { id: "n2", label: "논문.pdf", documentId: "d2" };

test("스킬 종류·결과 방식으로 고를 대상 종류를 정한다", () => {
  assert.equal(skillRunTargetKind(FOLDER_SKILL), "folder");
  assert.equal(skillRunTargetKind(version(["template"])), "folder");
  assert.equal(skillRunTargetKind(CREATE_SKILL), "folder");
  assert.equal(skillRunTargetKind(EDIT_SKILL), "document");
  assert.equal(skillRunTargetKind(AUTO_SKILL), "document-or-folder");
  // result_mode가 없는 예전 버전은 capability로 판단한다.
  assert.equal(skillRunTargetKind(version(["document-edit"])), "document");
  assert.equal(skillRunTargetKind(version(["document-create"])), "folder");
  assert.equal(skillRunTargetKind(null), "document-or-folder");
});

test("폴더 정리 스킬은 폴더만 고를 수 있고 문서를 고르면 안내한다", () => {
  const picked = resolveSkillRunTarget(FOLDER_SKILL, folder, documents);
  assert.deepEqual(picked, { status: "ok", target: { kind: "folder", itemId: "f1", folderId: "f1", label: "회의록" } });
  const wrong = resolveSkillRunTarget(FOLDER_SKILL, markdownItem, documents);
  assert.equal(wrong.status, "invalid");
  assert.match(wrong.message, /폴더/);
});

test("고칠 문서를 받는 스킬은 Markdown 문서만 고르고 폴더 클릭은 펼치기로 본다", () => {
  assert.deepEqual(resolveSkillRunTarget(EDIT_SKILL, markdownItem, documents), {
    status: "ok",
    target: { kind: "document", itemId: "n1", documentId: "d1", label: "회의.md" }
  });
  assert.equal(resolveSkillRunTarget(EDIT_SKILL, folder, documents).status, "ignore");
  const pdf = resolveSkillRunTarget(EDIT_SKILL, pdfItem, documents);
  assert.equal(pdf.status, "invalid");
  assert.match(pdf.message, /Markdown/);
});

test("새 문서를 만드는 스킬은 새 문서를 둘 폴더를 고른다", () => {
  assert.equal(resolveSkillRunTarget(CREATE_SKILL, folder, documents).status, "ok");
  const wrong = resolveSkillRunTarget(CREATE_SKILL, markdownItem, documents);
  assert.equal(wrong.status, "invalid");
  assert.match(wrong.message, /새 문서를 둘 폴더/);
});

test("상황에 맞게 스킬은 문서와 폴더를 모두 받는다", () => {
  assert.equal(resolveSkillRunTarget(AUTO_SKILL, markdownItem, documents).target.kind, "document");
  assert.equal(resolveSkillRunTarget(AUTO_SKILL, folder, documents).target.kind, "folder");
});

test("편집 권한이 없는 문서·폴더와 위키 페이지는 고를 수 없다", () => {
  assert.equal(resolveSkillRunTarget(EDIT_SKILL, { ...markdownItem, canEdit: false }, documents).status, "invalid");
  assert.equal(resolveSkillRunTarget(FOLDER_SKILL, { ...folder, canEdit: false }, documents).status, "invalid");
  assert.equal(resolveSkillRunTarget(AUTO_SKILL, { id: "w1", label: "개념", type: "wiki" }, documents).status, "invalid");
});

test("폴더 경로를 찾아 실행 요청 문장에 넣는다", () => {
  const projects = [{ id: "p", title: "문서", items: [{ id: "root", label: "연간 계획", type: "folder", children: [folder] }] }];
  assert.equal(treeItemPath(projects, "f1"), "연간 계획 / 회의록");
  assert.equal(treeItemPath(projects, "missing"), null);
  const folderTarget = { kind: "folder", itemId: "f1", folderId: "f1", label: "회의록" };
  assert.equal(skillRunMessage("tidy", FOLDER_SKILL, folderTarget, "연간 계획 / 회의록"), '/tidy 정리할 폴더: 연간 계획 / 회의록');
  assert.equal(skillRunMessage("draft", CREATE_SKILL, folderTarget, null), '/draft 새 문서를 둘 폴더: 회의록');
  const documentTarget = { kind: "document", itemId: "n1", documentId: "d1", label: "회의.md" };
  assert.equal(skillRunMessage("polish", EDIT_SKILL, documentTarget, null), "/polish");
});
