import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const {
  INITIAL_SKILL_CREATE_FORM,
  composeSkillInstructions,
  skillAllowedTools,
  skillCapabilities,
  skillPublishRequest,
  validateSkillCreateForm
} = await import("../src/features/skill-authoring/lib/skillCreateForm.ts");

const filledForm = {
  ...INITIAL_SKILL_CREATE_FORM,
  command: " research-summary ",
  description: " 연구 문서의 개요를 핵심 문장 3개로 정리합니다. ",
  rules: "'연구 개요' 섹션만 고친다.\n문체는 '~다'체로 맞춘다.\n"
};

test("스킬 종류·결과 방식을 capability로 바꾼다", () => {
  assert.deepEqual(skillCapabilities("document", "create"), ["document-create"]);
  assert.deepEqual(skillCapabilities("document", "edit"), ["document-edit"]);
  assert.deepEqual(skillCapabilities("document", "auto"), ["document-create", "document-edit"]);
  // 폴더 정리·템플릿은 결과 방식과 관계없이 capability 하나다.
  assert.deepEqual(skillCapabilities("folder", "edit"), ["folder-organize"]);
  assert.deepEqual(skillCapabilities("template", "auto"), ["template"]);
});

test("allowed_tools는 capability Tool 합집합이고 중복이 없으며 계획용 읽기 Tool을 포함한다", () => {
  const tools = skillAllowedTools(["document-create", "document-edit"]);
  assert.equal(new Set(tools).size, tools.length);
  for (const tool of ["list_root_items", "list_folder_children", "get_document_content", "create_document", "apply_document_edit"]) {
    assert.ok(tools.includes(tool), tool);
  }
  assert.ok(!skillAllowedTools(["document-create"]).includes("apply_document_edit"));
  assert.ok(skillAllowedTools(["folder-organize"]).includes("move_document"));
});

test("문서 스킬은 대상·'상황에 맞게'를 실행 대상 절로 지침에 덧붙인다", () => {
  const composed = composeSkillInstructions({ ...filledForm, resultMode: "auto", targets: ["current-document", "selection"] });
  assert.ok(composed.startsWith("'연구 개요' 섹션만 고친다.\n문체는 '~다'체로 맞춘다.\n\n## 실행 대상\n\n- 현재 문서\n"));
  assert.match(composed, /선택한 부분/);
  assert.match(composed, /되묻는다/);
});

test("대상이 없거나 문서 스킬이 아니면 실행 규칙만 보낸다", () => {
  assert.equal(composeSkillInstructions({ ...filledForm, targets: [] }), filledForm.rules.trim());
  assert.equal(composeSkillInstructions({ ...filledForm, kind: "folder" }), filledForm.rules.trim());
});

test("게시 요청은 공백을 다듬고 고른 범위·권한을 담는다", () => {
  const request = skillPublishRequest({ ...filledForm, scope: "team" });
  assert.equal(request.name, "research-summary");
  assert.equal(request.description, "연구 문서의 개요를 핵심 문장 3개로 정리합니다.");
  assert.equal(request.scope_type, "team");
  assert.deepEqual(request.capabilities, ["document-create"]);
  assert.ok(request.allowed_tools.includes("create_document"));
  assert.match(request.instructions_markdown, /## 실행 대상\n\n- 현재 문서$/);
});

test("필수값·커맨드 형식·중복 커맨드를 검증한다", () => {
  assert.deepEqual(Object.keys(validateSkillCreateForm(INITIAL_SKILL_CREATE_FORM, [])).sort(), ["command", "description", "rules"]);
  assert.deepEqual(validateSkillCreateForm(filledForm, []), {});
  assert.match(validateSkillCreateForm({ ...filledForm, command: "연구-요약" }, []).command, /영문 소문자/);
  assert.match(validateSkillCreateForm({ ...filledForm, command: "Research" }, []).command, /영문 소문자/);
  assert.match(validateSkillCreateForm(filledForm, ["research-summary"]).command, /이미 사용 중/);
  assert.match(validateSkillCreateForm({ ...filledForm, description: "가".repeat(501) }, []).description, /500자/);
});
