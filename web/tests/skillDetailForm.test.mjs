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
  savedSkillKind,
  savedSkillKindFromResult,
  detailCapabilitiesChange,
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
  assert.deepEqual(skillDetailDraft(form, savedSkillKind(skill({ enabled_version: version({ result_mode: null }) }))), {
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

test("skillDetailDraft는 결과 방식 저장값이 없는 문서 스킬에 targets만 담고(result_mode·capabilities 생략) 지침에 절을 붙이지 않는다", () => {
  const stored = skill();
  const form = { ...skillDetailForm(stored), command: " new-name ", description: "  새 설명 ", targets: ["current-document", "selection"] };
  assert.deepEqual(skillDetailDraft(form, savedSkillKind(stored)), {
    name: "new-name",
    description: "새 설명",
    instructionsMarkdown: RULES,
    targets: ["current_document", "selection"]
  });
});

test("skillDetailDraft는 폴더 정리·알 수 없는 스킬에 targets·result_mode·capabilities를 담지 않는다", () => {
  const folderSkill = skill({ enabled_version: version({ capabilities: ["folder-organize"] }) });
  const folder = skillDetailForm(folderSkill);
  assert.equal(folder.kind, "folder");
  assert.deepEqual(skillDetailDraft(folder, savedSkillKind(folderSkill)), {
    name: "research-summary",
    description: "연구 문서의 개요를 정리합니다.",
    instructionsMarkdown: RULES
  });
  const unknownSkill = skill({ enabled_version: version({ capabilities: ["unknown"] }) });
  const unknown = skillDetailForm(unknownSkill);
  assert.deepEqual(Object.keys(skillDetailDraft(unknown, savedSkillKind(unknownSkill))).sort(), ["description", "instructionsMarkdown", "name"]);
});

test("validateSkillDetailForm은 빈·잘못된·중복 커맨드, 빈 설명·규칙, 길이 초과와 문서 스킬의 빈 대상을 막는다", () => {
  const form = skillDetailForm(skill());
  assert.deepEqual(validateSkillDetailForm(form, []), {});
  assert.deepEqual(
    Object.keys(validateSkillDetailForm({ ...form, command: " ", description: " ", rules: "", targets: [] }, [])).sort(),
    ["command", "description", "rules", "targets"]
  );
  // 문서 스킬이 아니면 대상 필드가 없어 검사하지 않는다.
  assert.deepEqual(validateSkillDetailForm({ ...form, kind: "folder", targets: [] }, []), {});
  assert.deepEqual(validateSkillDetailForm({ ...form, kind: null, targets: [] }, []), {});
  assert.match(validateSkillDetailForm({ ...form, command: "Bad Name" }, []).command, /소문자/);
  assert.match(validateSkillDetailForm({ ...form, command: "taken" }, ["taken"]).command, /이미 사용 중/);
  assert.match(validateSkillDetailForm({ ...form, description: "a".repeat(501) }, []).description, /500자/);
  assert.match(validateSkillDetailForm({ ...form, rules: "a".repeat(30_001) }, []).rules, /30,000자/);
});

test("skillDetailAuthorForm은 상세 값을 테스트 실행 카드의 만들기 시트 모양으로 옮긴다(바꾼 종류·결과 방식을 따른다)", () => {
  const form = { ...skillDetailForm(skill({ scope_type: "workspace" })), rules: "새 규칙" };
  const authorForm = skillDetailAuthorForm(form);
  assert.equal(authorForm.scope, "team");
  assert.equal(authorForm.command, "research-summary");
  assert.equal(authorForm.rules, "새 규칙");
  assert.equal(authorForm.resultMode, "edit");
  // 종류를 바꾸면 테스트 실행도 그 종류로 capability를 정한다.
  assert.equal(skillDetailAuthorForm({ ...form, resultMode: "create" }).resultMode, "create");
  assert.equal(skillDetailAuthorForm({ ...form, kind: "folder" }).kind, "folder");
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
  // 폴더 정리를 문서 '새 문서로 만들기'로 바꾸면 서버 값(false)으로 필드가 나타난다.
  const folder = skillDetailForm(skill({ enabled_version: version({ capabilities: ["folder-organize"], requires_source: false }) }));
  assert.equal(showsDetailSourceField({ ...folder, kind: "document", resultMode: "create" }), true);
});

test("skillDetailDraft는 원문 문서 필드가 보이면 바꾸지 않았어도 화면 값을 requires_source로 보낸다", () => {
  const stored = skill({ enabled_version: version({ capabilities: ["document-create"], result_mode: "create", requires_source: true }) });
  const saved = savedSkillKind(stored);
  const form = skillDetailForm(stored);
  assert.equal(skillDetailDraft(form, saved).requires_source, true);
  assert.equal(skillDetailDraft({ ...form, requiresSource: false }, saved).requires_source, false);
  // 필드가 보이지 않는 결과 방식으로 바꾸면 보내지 않는다.
  assert.ok(!("requires_source" in skillDetailDraft({ ...form, resultMode: "edit", requiresSource: false }, saved)));
  // 서버가 값을 주지 않으면(구버전) 필드가 없어 보내지 않는다.
  const legacySkill = skill({ enabled_version: version({ capabilities: ["document-create"], result_mode: "create" }) });
  assert.ok(!("requires_source" in skillDetailDraft(skillDetailForm(legacySkill), savedSkillKind(legacySkill))));
});

test("skillDetailDraft는 실행 규칙만 고친 저장에 capabilities 없이 저장된 결과 방식·대상·원문 문서를 함께 보낸다", () => {
  const stored = skill({
    enabled_version: version({ capabilities: ["document-create"], targets: ["selection"], result_mode: "create", requires_source: false })
  });
  const form = { ...skillDetailForm(stored), rules: "새 실행 규칙" };
  assert.deepEqual(skillDetailDraft(form, savedSkillKind(stored)), {
    name: "research-summary",
    description: "연구 문서의 개요를 정리합니다.",
    instructionsMarkdown: "새 실행 규칙",
    targets: ["selection"],
    result_mode: "create",
    requires_source: false
  });
});

test("skillDetailDraft는 결과 방식을 바꾸면 capabilities와 result_mode를 함께 보낸다", () => {
  const stored = skill({ enabled_version: version({ capabilities: ["document-edit"], targets: ["current_document"], result_mode: "edit", requires_source: false }) });
  const saved = savedSkillKind(stored);
  const form = skillDetailForm(stored);
  assert.deepEqual(skillDetailDraft({ ...form, resultMode: "auto" }, saved), {
    name: "research-summary",
    description: "연구 문서의 개요를 정리합니다.",
    instructionsMarkdown: RULES,
    capabilities: ["document-create", "document-edit"],
    targets: ["current_document"],
    result_mode: "auto",
    requires_source: false
  });
  assert.deepEqual(skillDetailDraft({ ...form, resultMode: "create" }, saved).capabilities, ["document-create"]);
  // 결과 방식 저장값이 없는 예전 스킬도 바꾸면 result_mode를 명시해 보낸다.
  const legacySkill = skill({ enabled_version: version({ capabilities: ["document-edit"], result_mode: null }) });
  const legacy = skillDetailDraft({ ...skillDetailForm(legacySkill), resultMode: "create" }, savedSkillKind(legacySkill));
  assert.deepEqual(legacy.capabilities, ["document-create"]);
  assert.equal(legacy.result_mode, "create");
});

test("skillDetailDraft는 종류를 바꾸면 capabilities를 보내고, 문서 스킬이 아니게 되면 targets·result_mode·requires_source를 뺀다", () => {
  const docSkill = skill({ enabled_version: version({ capabilities: ["document-create"], targets: ["selection"], result_mode: "create", requires_source: true }) });
  assert.deepEqual(skillDetailDraft({ ...skillDetailForm(docSkill), kind: "folder" }, savedSkillKind(docSkill)), {
    name: "research-summary",
    description: "연구 문서의 개요를 정리합니다.",
    instructionsMarkdown: RULES,
    capabilities: ["folder-organize"]
  });
  // 폴더 정리 → 문서: 대상(기본 현재 문서)·결과 방식을 함께 보낸다.
  const folderSkill = skill({ enabled_version: version({ capabilities: ["folder-organize"], targets: [], result_mode: null, requires_source: false }) });
  const toDocument = skillDetailDraft({ ...skillDetailForm(folderSkill), kind: "document", resultMode: "edit" }, savedSkillKind(folderSkill));
  assert.deepEqual(toDocument.capabilities, ["document-edit"]);
  assert.deepEqual(toDocument.targets, ["current_document"]);
  assert.equal(toDocument.result_mode, "edit");
  assert.ok(!("requires_source" in toDocument));
  // 종류를 알 수 없던 스킬은 종류를 고르면 보낸다.
  const unknownSkill = skill({ enabled_version: version({ capabilities: ["unknown"] }) });
  assert.deepEqual(skillDetailDraft({ ...skillDetailForm(unknownSkill), kind: "folder" }, savedSkillKind(unknownSkill)).capabilities, ["folder-organize"]);
});

test("skillDetailDraft는 폴더 정리 스킬의 실행 규칙만 고칠 때 대상·결과 방식·원문 문서·capabilities를 싣지 않는다", () => {
  const folderSkill = skill({ enabled_version: version({ capabilities: ["folder-organize"], targets: [], result_mode: null, requires_source: false }) });
  const form = { ...skillDetailForm(folderSkill), rules: "문서 이름을 날짜로 시작하게 바꾼다." };
  assert.deepEqual(skillDetailDraft(form, savedSkillKind(folderSkill)), {
    name: "research-summary",
    description: "연구 문서의 개요를 정리합니다.",
    instructionsMarkdown: "문서 이름을 날짜로 시작하게 바꾼다."
  });
});

test("detailCapabilitiesChange는 잘못 저장된 조합을 보이는 종류로 바로잡고, 고를 수 있는 조합은 바꾸지 않으면 보내지 않는다", () => {
  // document-edit + folder-organize는 '폴더 정리'로 보이고, 저장하면 그 종류로 바로잡는다.
  const broken = skill({ enabled_version: version({ capabilities: ["document-edit", "folder-organize"], targets: ["current_document"], result_mode: null }) });
  const form = skillDetailForm(broken);
  assert.equal(form.kind, "folder");
  assert.deepEqual(detailCapabilitiesChange(form, savedSkillKind(broken)), ["folder-organize"]);
  assert.deepEqual(skillDetailDraft(form, savedSkillKind(broken)), {
    name: "research-summary",
    description: "연구 문서의 개요를 정리합니다.",
    instructionsMarkdown: RULES,
    capabilities: ["folder-organize"]
  });
  // 사용자가 문서로 다시 고르면 문서 capabilities와 대상·결과 방식을 보낸다.
  const repaired = skillDetailDraft({ ...form, kind: "document", resultMode: "edit" }, savedSkillKind(broken));
  assert.deepEqual(repaired.capabilities, ["document-edit"]);
  assert.equal(repaired.result_mode, "edit");
  // 둘 다 허용(auto 조합)에 result_mode가 edit로 저장된 스킬은 고를 수 있는 조합이라 그대로 둔다.
  const both = skill({ enabled_version: version({ capabilities: ["document-create", "document-edit"], result_mode: "edit" }) });
  assert.equal(detailCapabilitiesChange(skillDetailForm(both), savedSkillKind(both)), null);
  // 템플릿은 그대로 두면 보내지 않는다.
  const template = skill({ enabled_version: version({ capabilities: ["template"] }) });
  assert.equal(detailCapabilitiesChange(skillDetailForm(template), savedSkillKind(template)), null);
});

test("savedSkillKindFromResult는 저장 응답을 다음 저장의 비교 기준으로 만든다", () => {
  const saved = savedSkillKindFromResult({ capabilities: ["document-create"], result_mode: "create" });
  assert.deepEqual(saved.shown, { kind: "document", resultMode: "create" });
  assert.equal(detailCapabilitiesChange({ kind: "document", resultMode: "create" }, saved), null);
  assert.deepEqual(detailCapabilitiesChange({ kind: "document", resultMode: "auto" }, saved), ["document-create", "document-edit"]);
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
