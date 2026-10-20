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
  parseSkillInstructions,
  requiresSourceDrift,
  showsDetailSourceField,
  resultModeAfterRejection,
  resultModeDrift,
  skillDetailAuthorForm,
  skillDetailDraft,
  skillDetailForm,
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

// 이전 만들기 시트가 지침 끝에 붙이던 절(서버에 targets 필드가 생기기 전 형식)
const LEGACY_CURRENT = "- 현재 문서";
const LEGACY_SELECTION = "- 사용자가 선택한 부분 (선택한 부분이 있으면 그 부분만 다룬다)";
const LEGACY_AUTO = "- 새 문서로 만들지 현재 문서를 고칠지 대상이 애매하면 먼저 사용자에게 되묻는다.";
const legacy = (...lines) => `${RULES}\n\n## 실행 대상\n\n${lines.join("\n")}`;

test("parseSkillInstructions는 이전 시트가 붙인 실행 대상 절을 규칙과 대상으로 나눈다", () => {
  assert.deepEqual(parseSkillInstructions(legacy(LEGACY_CURRENT, LEGACY_SELECTION, LEGACY_AUTO)), {
    rules: RULES,
    targets: ["current-document", "selection"]
  });
  assert.deepEqual(parseSkillInstructions(`${legacy(LEGACY_SELECTION)}\n`), { rules: RULES, targets: ["selection"] });
  // 결과 방식 안내만 있는 절도 기계가 만든 형식이라 떼어 낸다.
  assert.deepEqual(parseSkillInstructions(legacy(LEGACY_AUTO)), { rules: RULES, targets: [] });
});

test("parseSkillInstructions는 절이 없으면 지침 전체를 규칙으로 둔다", () => {
  assert.deepEqual(parseSkillInstructions(`  ${RULES}\n`), { rules: RULES, targets: null });
});

test("parseSkillInstructions는 기계가 만든 형식과 조금이라도 다르면 지침을 건드리지 않는다", () => {
  for (const markdown of [
    legacy(LEGACY_CURRENT, "- 표만 고친다"),
    legacy(LEGACY_SELECTION, LEGACY_CURRENT), // 순서가 다르다
    `${RULES}\n## 실행 대상\n\n${LEGACY_CURRENT}`, // 빈 줄이 하나 빠졌다
    `${RULES}\n\n## 실행 대상\n\n${LEGACY_CURRENT}\n\n덧붙인 문단`,
    `## 실행 대상\n\n${LEGACY_CURRENT}` // 규칙이 없다
  ]) {
    assert.deepEqual(parseSkillInstructions(markdown), { rules: markdown.trim(), targets: null }, markdown);
  }
});

test("skillDetailForm은 버전의 targets·result_mode를 읽는다", () => {
  const form = skillDetailForm(
    skill({ scope_type: "workspace", enabled_version: version({ capabilities: ["document-create", "document-edit"], targets: ["selection"], result_mode: "edit" }) })
  );
  assert.deepEqual(form, {
    kind: "document",
    resultMode: "edit",
    scope: "team",
    command: "research-summary",
    description: "연구 문서의 개요를 정리합니다.",
    rules: RULES,
    targets: ["selection"],
    requiresSource: null
  });
});

test("skillDetailForm은 result_mode가 없으면 capabilities에서, targets가 없으면 기본 대상으로 채운다", () => {
  const form = skillDetailForm(skill({ enabled_version: version({ capabilities: ["document-create", "document-edit"], result_mode: null }) }));
  assert.equal(form.resultMode, "auto");
  assert.deepEqual(form.targets, ["current-document"]);
});

test("skillDetailForm은 이전 형식의 실행 대상 절이 있으면 그 대상을 쓰고 절을 지침에서 뗀다", () => {
  // 필드가 생기기 전에 게시돼 서버가 두 대상 모두(또는 기본값)로 읽어 주는 스킬이다.
  const form = skillDetailForm(
    skill({ enabled_version: version({ instructions_markdown: legacy(LEGACY_SELECTION), targets: ["current_document", "selection"], result_mode: null }) })
  );
  assert.equal(form.rules, RULES);
  assert.deepEqual(form.targets, ["selection"]);
  assert.deepEqual(skillDetailDraft(form), {
    name: "research-summary",
    description: "연구 문서의 개요를 정리합니다.",
    instructionsMarkdown: RULES,
    targets: ["selection"]
  });
});

test("skillDetailForm은 손댄 절은 지침에 두고 서버 targets를 쓴다", () => {
  const edited = legacy(LEGACY_CURRENT, "- 표만 고친다");
  const form = skillDetailForm(skill({ enabled_version: version({ instructions_markdown: edited, targets: ["current_document"] }) }));
  assert.equal(form.rules, edited);
  assert.deepEqual(form.targets, ["current-document"]);
});

test("skillDetailForm은 켜진 버전이 없으면 최신 버전을, capabilities를 모르면 종류를 null로 둔다", () => {
  const form = skillDetailForm(
    skill({ enabled_version: null, latest_version: version({ capabilities: ["unknown"], description: "최신" }) })
  );
  assert.equal(form.kind, null);
  assert.equal(form.description, "최신");
  assert.equal(skillDetailForm(skill({ enabled_version: null, latest_version: null })).rules, "");
});

test("skillDetailDraft는 문서 스킬에 targets만 담고(result_mode는 생략해 서버가 유지) 지침에 절을 붙이지 않는다", () => {
  const form = { ...skillDetailForm(skill()), command: " new-name ", description: "  새 설명 ", targets: ["current-document", "selection"] };
  assert.deepEqual(skillDetailDraft(form), {
    name: "new-name",
    description: "새 설명",
    instructionsMarkdown: RULES,
    targets: ["current_document", "selection"]
  });
});

test("skillDetailDraft는 폴더 정리·알 수 없는 스킬에 targets·result_mode를 담지 않는다", () => {
  const folder = skillDetailForm(skill({ enabled_version: version({ capabilities: ["folder-organize"] }) }));
  assert.equal(folder.kind, "folder");
  assert.deepEqual(skillDetailDraft(folder), { name: "research-summary", description: "연구 문서의 개요를 정리합니다.", instructionsMarkdown: RULES });
  const unknown = skillDetailForm(skill({ enabled_version: version({ capabilities: ["unknown"] }) }));
  assert.deepEqual(Object.keys(skillDetailDraft(unknown)).sort(), ["description", "instructionsMarkdown", "name"]);
});

test("validateSkillDetailForm은 빈·잘못된·중복 커맨드, 빈 설명·규칙과 길이 초과를 막는다(대상은 화면에 없어 검사하지 않는다)", () => {
  const form = skillDetailForm(skill());
  assert.deepEqual(validateSkillDetailForm(form, []), {});
  assert.deepEqual(
    Object.keys(validateSkillDetailForm({ ...form, command: " ", description: " ", rules: "", targets: [] }, [])).sort(),
    ["command", "description", "rules"]
  );
  assert.match(validateSkillDetailForm({ ...form, command: "Bad Name" }, []).command, /소문자/);
  assert.match(validateSkillDetailForm({ ...form, command: "taken" }, ["taken"]).command, /이미 사용 중/);
  assert.match(validateSkillDetailForm({ ...form, description: "a".repeat(501) }, []).description, /500자/);
  assert.match(validateSkillDetailForm({ ...form, rules: "a".repeat(30_001) }, []).rules, /30,000자/);
});

test("skillDetailAuthorForm은 상세 값을 테스트 실행 카드의 만들기 시트 모양으로 옮긴다", () => {
  const form = { ...skillDetailForm(skill({ scope_type: "workspace" })), rules: "새 규칙" };
  const authorForm = skillDetailAuthorForm(form);
  assert.equal(authorForm.scope, "team");
  assert.equal(authorForm.command, "research-summary");
  assert.equal(authorForm.rules, "새 규칙");
  assert.equal(authorForm.resultMode, "edit");
});

test("skillDetailDraft는 다시 고른 결과 방식을 문서 스킬일 때만 result_mode로 담는다", () => {
  const form = skillDetailForm(skill());
  assert.equal(skillDetailDraft(form, "create").result_mode, "create");
  assert.ok(!("result_mode" in skillDetailDraft(form)));
  const folder = skillDetailForm(skill({ enabled_version: version({ capabilities: ["folder-organize"] }) }));
  assert.ok(!("result_mode" in skillDetailDraft(folder, "create")));
});

test("resultModeDrift는 저장 응답에서 결과 방식이 비워졌을 때만 저장 전 값과 새 capabilities에 맞는 값을 준다", () => {
  const stored = skill({ enabled_version: version({ capabilities: ["document-edit"], result_mode: "edit" }) });
  // 지침을 다시 분류해 document-create가 됐고, 생략해 이어받은 edit가 맞지 않아 null로 버려졌다.
  assert.deepEqual(resultModeDrift(stored, { capabilities: ["document-create"], result_mode: null }), { from: "edit", to: "create" });
  assert.deepEqual(resultModeDrift(stored, { capabilities: ["document-create", "document-edit"], result_mode: null }), { from: "edit", to: "auto" });
  // 그대로 유지됐거나, 원래 결과 방식이 없었거나(예전 스킬), 문서 스킬이 아니게 됐으면 고를 것이 없다.
  assert.equal(resultModeDrift(stored, { capabilities: ["document-edit"], result_mode: "edit" }), null);
  assert.equal(resultModeDrift(skill(), { capabilities: ["document-create"], result_mode: null }), null);
  assert.equal(resultModeDrift(stored, { capabilities: ["folder-organize"], result_mode: null }), null);
});

test("resultModeAfterRejection은 거절된 결과 방식에서 빠졌을 capability를 피해 다른 값을 고른다", () => {
  assert.equal(resultModeAfterRejection("edit"), "create");
  assert.equal(resultModeAfterRejection("create"), "edit");
  assert.equal(resultModeAfterRejection("auto"), "edit");
});

test("상세 시트의 원문 문서는 서버 값이 있고 새 문서를 만들 수 있는 문서 스킬에만 보인다", () => {
  const create = skillDetailForm(skill({ enabled_version: version({ capabilities: ["document-create"], result_mode: "create", requires_source: true }) }));
  assert.equal(create.requiresSource, true);
  assert.equal(showsDetailSourceField(create), true);
  const auto = skillDetailForm(skill({ enabled_version: version({ capabilities: ["document-create", "document-edit"], result_mode: "auto", requires_source: false }) }));
  assert.equal(showsDetailSourceField(auto), true);
  // 고치기 전용·폴더 정리·템플릿, 그리고 이 필드를 주지 않는 백엔드(구버전)는 감춘다.
  assert.equal(showsDetailSourceField(skillDetailForm(skill({ enabled_version: version({ result_mode: "edit", requires_source: true }) }))), false);
  assert.equal(showsDetailSourceField(skillDetailForm(skill({ enabled_version: version({ capabilities: ["folder-organize"], requires_source: false }) }))), false);
  assert.equal(showsDetailSourceField(skillDetailForm(skill({ enabled_version: version({ capabilities: ["template"], requires_source: false }) }))), false);
  const legacy = skillDetailForm(skill({ enabled_version: version({ capabilities: ["document-create"], result_mode: "create" }) }));
  assert.equal(legacy.requiresSource, null);
  assert.equal(showsDetailSourceField(legacy), false);
});

test("skillDetailDraft는 원문 문서를 저장된 값에서 바꿨을 때만 requires_source로 보낸다", () => {
  const form = skillDetailForm(skill({ enabled_version: version({ capabilities: ["document-create"], result_mode: "create", requires_source: true }) }));
  assert.ok(!("requires_source" in skillDetailDraft(form)));
  assert.equal(skillDetailDraft({ ...form, requiresSource: false }, undefined, true).requires_source, false);
  // 필드가 보이지 않는 스킬은 바꿨어도 보내지 않는다.
  assert.ok(!("requires_source" in skillDetailDraft({ ...form, resultMode: "edit", requiresSource: false }, undefined, true)));
});

test("requiresSourceDrift는 보내지 않은 저장에서 AI가 원문 문서를 바꿨을 때만 이전·이후 값을 준다", () => {
  const created = { capabilities: ["document-create"], result_mode: "create" };
  assert.deepEqual(requiresSourceDrift(false, undefined, { ...created, requires_source: true }), { from: false, to: true });
  assert.equal(requiresSourceDrift(false, undefined, { ...created, requires_source: false }), null);
  // 직접 골라 보냈거나, 원래 값이 없었거나, 응답에 값이 없거나, 다시 분류된 스킬이 고치기 전용이면 알리지 않는다.
  assert.equal(requiresSourceDrift(false, true, { ...created, requires_source: true }), null);
  assert.equal(requiresSourceDrift(null, undefined, { ...created, requires_source: true }), null);
  assert.equal(requiresSourceDrift(false, undefined, created), null);
  assert.equal(requiresSourceDrift(false, undefined, { capabilities: ["document-edit"], result_mode: "edit", requires_source: true }), null);
});
