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

const { composeSkillInstructions } = await import("../src/features/skill-authoring/lib/skillCreateForm.ts");
const {
  applySkillDetailDraft,
  parseSkillInstructions,
  skillDetailAuthorForm,
  skillDetailDraft,
  skillDetailForm,
  skillDetailInstructions,
  validateSkillDetailForm
} = await import("../src/features/skill-authoring/lib/skillDetailForm.ts");

const RULES = "'연구 개요' 섹션만 고친다.\n문체는 '~다'체로 맞춘다.";

function version(overrides = {}) {
  return {
    id: "v1",
    name: "research-summary",
    description: "연구 문서의 개요를 정리합니다.",
    status: "enabled",
    version: 1,
    allowed_tools: [],
    capabilities: ["document-edit"],
    instructions_markdown: RULES,
    ...overrides
  };
}

function skill(overrides = {}) {
  return {
    id: "skill_1",
    workspace_id: "ws",
    owner_user_id: "u1",
    slug: "research-summary",
    scope_type: "personal",
    status: "enabled",
    enabled_version: version(),
    latest_version: version(),
    ...overrides
  };
}

test("parseSkillInstructions는 만들기 시트가 붙인 실행 대상 절을 규칙과 대상으로 나눈다", () => {
  const composed = composeSkillInstructions({
    kind: "document",
    resultMode: "auto",
    targets: ["current-document", "selection"],
    rules: RULES
  });
  assert.deepEqual(parseSkillInstructions(composed), {
    rules: RULES,
    targets: ["current-document", "selection"],
    hasTargetSection: true
  });
});

test("parseSkillInstructions는 결과 방식 안내만 있는 절도 대상 없이 읽는다", () => {
  const composed = composeSkillInstructions({ kind: "document", resultMode: "auto", targets: [], rules: RULES });
  assert.deepEqual(parseSkillInstructions(composed), { rules: RULES, targets: [], hasTargetSection: true });
});

test("parseSkillInstructions는 절이 없으면 지침 전체를 규칙으로 둔다", () => {
  assert.deepEqual(parseSkillInstructions(`  ${RULES}\n`), { rules: RULES, targets: [], hasTargetSection: false });
});

test("parseSkillInstructions는 사용자가 쓴 다른 줄이 섞인 절을 건드리지 않는다", () => {
  const markdown = `${RULES}\n\n## 실행 대상\n\n- 현재 문서\n- 표만 고친다`;
  assert.deepEqual(parseSkillInstructions(markdown), { rules: markdown, targets: [], hasTargetSection: false });
});

test("skillDetailForm은 켜진 버전에서 저장범위·결과 방식·대상을 되읽는다", () => {
  const instructions = composeSkillInstructions({ kind: "document", resultMode: "edit", targets: ["selection"], rules: RULES });
  const form = skillDetailForm(
    skill({ scope_type: "workspace", enabled_version: version({ instructions_markdown: instructions }) })
  );
  assert.deepEqual(form, {
    kind: "document",
    resultMode: "edit",
    scope: "team",
    command: "research-summary",
    description: "연구 문서의 개요를 정리합니다.",
    rules: RULES,
    targets: ["selection"],
    hasTargetSection: true
  });
});

test("skillDetailForm은 켜진 버전이 없으면 최신 버전을, capabilities를 모르면 종류를 null로 둔다", () => {
  const form = skillDetailForm(
    skill({ enabled_version: null, latest_version: version({ capabilities: ["unknown"], description: "최신" }) })
  );
  assert.equal(form.kind, null);
  assert.equal(form.description, "최신");
  assert.equal(skillDetailForm(skill({ enabled_version: null, latest_version: null })).rules, "");
});

test("skillDetailInstructions는 대상을 고친 만큼 실행 대상 절을 다시 붙인다", () => {
  const form = { ...skillDetailForm(skill()), targets: ["current-document"] };
  assert.equal(skillDetailInstructions(form), `${RULES}\n\n## 실행 대상\n\n- 현재 문서`);
});

test("skillDetailInstructions는 원래 절이 없고 대상도 없으면 규칙을 그대로 저장한다", () => {
  const form = skillDetailForm(skill({ enabled_version: version({ capabilities: ["document-create", "document-edit"] }) }));
  assert.equal(form.resultMode, "auto");
  assert.equal(skillDetailInstructions(form), RULES);
});

test("skillDetailInstructions는 문서가 아닌 스킬에 절을 붙이지 않는다", () => {
  const form = { ...skillDetailForm(skill({ enabled_version: version({ capabilities: ["folder-organize"] }) })), targets: ["selection"] };
  assert.equal(form.kind, "folder");
  assert.equal(skillDetailInstructions(form), RULES);
});

test("skillDetailDraft는 설명을 다듬고 지침을 합친다", () => {
  const form = { ...skillDetailForm(skill()), description: "  새 설명 ", targets: ["selection"] };
  assert.deepEqual(skillDetailDraft(form), {
    description: "새 설명",
    instructionsMarkdown: `${RULES}\n\n## 실행 대상\n\n- 사용자가 선택한 부분 (선택한 부분이 있으면 그 부분만 다룬다)`
  });
});

test("validateSkillDetailForm은 빈 설명·규칙과 길이 초과를 막는다", () => {
  const form = skillDetailForm(skill());
  assert.deepEqual(validateSkillDetailForm(form), {});
  assert.deepEqual(Object.keys(validateSkillDetailForm({ ...form, description: " ", rules: "" })).sort(), ["description", "rules"]);
  assert.match(validateSkillDetailForm({ ...form, description: "a".repeat(501) }).description, /500자/);
  assert.match(validateSkillDetailForm({ ...form, rules: "a".repeat(30_001) }).rules, /30,000자/);
});

test("skillDetailAuthorForm은 상세 값을 AI 작성 요청 모양으로 옮긴다", () => {
  const form = { ...skillDetailForm(skill({ scope_type: "workspace" })), rules: "새 규칙" };
  const authorForm = skillDetailAuthorForm(form);
  assert.equal(authorForm.scope, "team");
  assert.equal(authorForm.command, "research-summary");
  assert.equal(authorForm.rules, "새 규칙");
  assert.equal(authorForm.resultMode, "edit");
});

test("applySkillDetailDraft는 실행 규칙만 바꾸고 비어 있는 설명만 채운다", () => {
  const form = skillDetailForm(skill());
  const next = applySkillDetailDraft(form, { description: "AI 설명", instructions_markdown: "AI 규칙" });
  assert.equal(next.rules, "AI 규칙");
  assert.equal(next.description, form.description);
  assert.equal(applySkillDetailDraft({ ...form, description: "" }, { description: "AI 설명", instructions_markdown: "" }).description, "AI 설명");
  assert.equal(applySkillDetailDraft(form, { description: "", instructions_markdown: "  " }).rules, RULES);
});

test("applySkillDetailDraft는 초안의 실행 대상 절을 대상으로 되읽는다", () => {
  const form = skillDetailForm(skill());
  const next = applySkillDetailDraft(form, { description: "", instructions_markdown: `AI 규칙\n\n## 실행 대상\n\n- 현재 문서` });
  assert.equal(next.rules, "AI 규칙");
  assert.deepEqual(next.targets, ["current-document"]);
  assert.equal(next.hasTargetSection, true);
});
