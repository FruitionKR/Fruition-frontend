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
  skillCapabilities,
  skillExecutionOptions,
  skillPublishRequest,
  targetsFromValues,
  validateSkillCreateForm
} = await import("../src/features/skill-authoring/lib/skillCreateForm.ts");

const filledForm = {
  ...INITIAL_SKILL_CREATE_FORM,
  resultMode: "create",
  command: " research-summary ",
  description: " 연구 문서의 개요를 핵심 문장 3개로 정리합니다. ",
  rules: "'연구 개요' 섹션만 고친다.\n문체는 '~다'체로 맞춘다.\n"
};

test("새 스킬은 문서 종류·'상황에 맞게'로 시작해 새 문서·수정을 모두 허용한다", () => {
  assert.equal(INITIAL_SKILL_CREATE_FORM.kind, "document");
  assert.equal(INITIAL_SKILL_CREATE_FORM.resultMode, "auto");
  const request = skillPublishRequest({
    ...INITIAL_SKILL_CREATE_FORM,
    command: "research-summary",
    description: "연구 개요를 정리합니다.",
    rules: "'연구 개요' 섹션만 고친다."
  });
  assert.deepEqual(request.capabilities, ["document-create", "document-edit"]);
  assert.equal(request.result_mode, "auto");
});

test("스킬 종류·결과 방식을 capability로 바꾼다", () => {
  assert.deepEqual(skillCapabilities("document", "create"), ["document-create"]);
  assert.deepEqual(skillCapabilities("document", "edit"), ["document-edit"]);
  assert.deepEqual(skillCapabilities("document", "auto"), ["document-create", "document-edit"]);
  // 폴더 정리·템플릿은 결과 방식과 관계없이 capability 하나다.
  assert.deepEqual(skillCapabilities("folder", "edit"), ["folder-organize"]);
  assert.deepEqual(skillCapabilities("template", "auto"), ["template"]);
});

test("문서 스킬의 대상·결과 방식을 targets·result_mode로 바꾼다", () => {
  assert.deepEqual(skillExecutionOptions("document", "auto", ["selection", "current-document"]), {
    targets: ["current_document", "selection"],
    result_mode: "auto"
  });
  assert.deepEqual(skillExecutionOptions("document", "edit", ["selection"]), { targets: ["selection"], result_mode: "edit" });
  // 폴더 정리·템플릿에 보내면 서버가 invalid_targets/invalid_result_mode로 거절한다.
  assert.deepEqual(skillExecutionOptions("folder", "create", ["current-document"]), {});
  assert.deepEqual(skillExecutionOptions("template", "create", ["current-document"]), {});
});

test("서버 targets 값을 시트 대상으로 되돌린다", () => {
  assert.deepEqual(targetsFromValues(["selection", "current_document"]), ["current-document", "selection"]);
  assert.deepEqual(targetsFromValues(["selection", "unknown"]), ["selection"]);
  assert.deepEqual(targetsFromValues([]), []);
});

test("게시 요청은 공백을 다듬고 범위·capability·targets·result_mode를 담으며 allowed_tools는 뺀다", () => {
  const request = skillPublishRequest({ ...filledForm, scope: "team" });
  assert.deepEqual(request, {
    name: "research-summary",
    description: "연구 문서의 개요를 핵심 문장 3개로 정리합니다.",
    instructions_markdown: filledForm.rules.trim(),
    scope_type: "team",
    capabilities: ["document-create"],
    targets: ["current_document"],
    result_mode: "create"
  });
});

test("'선택한 부분'만 고르면 targets가 selection 하나이고 지침에 실행 대상 절을 붙이지 않는다", () => {
  const request = skillPublishRequest({ ...filledForm, resultMode: "edit", targets: ["selection"] });
  assert.deepEqual(request.targets, ["selection"]);
  assert.equal(request.result_mode, "edit");
  assert.deepEqual(request.capabilities, ["document-edit"]);
  assert.doesNotMatch(request.instructions_markdown, /실행 대상/);
});

test("폴더 정리·템플릿 게시 요청에는 targets·result_mode 키가 없다", () => {
  for (const kind of ["folder", "template"]) {
    const request = skillPublishRequest({ ...filledForm, kind });
    assert.ok(!("targets" in request) && !("result_mode" in request), kind);
    assert.ok(!("allowed_tools" in request), kind);
  }
});

test("필수값·커맨드 형식·중복 커맨드를 검증한다", () => {
  assert.deepEqual(Object.keys(validateSkillCreateForm(INITIAL_SKILL_CREATE_FORM, [])).sort(), ["command", "description", "rules"]);
  // 문서 스킬은 대상을 하나 이상 골라야 한다. 폴더 정리는 대상이 없다.
  assert.match(validateSkillCreateForm({ ...filledForm, targets: [] }, []).targets, /대상/);
  assert.deepEqual(validateSkillCreateForm({ ...filledForm, kind: "folder", targets: [] }, []), {});
  assert.deepEqual(validateSkillCreateForm(filledForm, []), {});
  assert.match(validateSkillCreateForm({ ...filledForm, command: "연구-요약" }, []).command, /영문 소문자/);
  assert.match(validateSkillCreateForm({ ...filledForm, command: "Research" }, []).command, /영문 소문자/);
  assert.match(validateSkillCreateForm(filledForm, ["research-summary"]).command, /이미 사용 중/);
  assert.match(validateSkillCreateForm({ ...filledForm, description: "가".repeat(501) }, []).description, /500자/);
});

const { applySkillDraft, kindFromCapabilities, skillAuthorRequest } = await import("../src/features/skill-authoring/lib/skillCreateForm.ts");

test("AI 작성 요청은 실행 규칙을 지시문으로 보내고 유효한 이름·설명·참고 문서만 담는다", () => {
  const request = skillAuthorRequest({ ...filledForm, scope: "team" }, "enhance", ["doc_1", "doc_2"]);
  assert.deepEqual(request, {
    instruction: filledForm.rules.trim(),
    authoring_mode: "enhance",
    scope_type: "team",
    name: "research-summary",
    description: "연구 문서의 개요를 핵심 문장 3개로 정리합니다.",
    reference_document_ids: ["doc_1", "doc_2"]
  });
  const bare = skillAuthorRequest({ ...filledForm, command: "연구", description: "" }, "regenerate", []);
  assert.equal(bare.authoring_mode, "regenerate");
  assert.ok(!("name" in bare) && !("description" in bare) && !("reference_document_ids" in bare));
});

test("AI capability를 스킬 종류·결과 방식으로 되돌린다", () => {
  assert.deepEqual(kindFromCapabilities(["document-create", "document-edit"]), { kind: "document", resultMode: "auto" });
  assert.deepEqual(kindFromCapabilities(["document-edit"]), { kind: "document", resultMode: "edit" });
  assert.equal(kindFromCapabilities(["folder-organize", "document-edit"]).kind, "folder");
  assert.equal(kindFromCapabilities(["template"]).kind, "template");
  assert.equal(kindFromCapabilities([]), null);
});

test("AI 초안은 실행 규칙을 바꾸고 이름·설명은 비어 있을 때만 채운다", () => {
  const draft = { name: "meeting-notes", description: "회의록 요약", instructions_markdown: "# 회의록\n\n요약한다.", capabilities: ["document-edit"] };
  const empty = applySkillDraft({ ...INITIAL_SKILL_CREATE_FORM, rules: "회의록 요약" }, draft);
  assert.equal(empty.rules, draft.instructions_markdown);
  assert.equal(empty.command, "meeting-notes");
  assert.equal(empty.description, "회의록 요약");
  assert.equal(empty.resultMode, "edit");
  const kept = applySkillDraft(filledForm, draft);
  assert.equal(kept.command, filledForm.command);
  assert.equal(kept.description, filledForm.description);
  // 차단 응답은 지침이 null이라 입력한 규칙을 유지한다.
  assert.equal(applySkillDraft(filledForm, { ...draft, instructions_markdown: null }).rules, filledForm.rules);
});

test("AI 초안의 capability로 기본 '상황에 맞게'를 덮고, capability가 없으면 고른 결과 방식을 유지한다", () => {
  const draft = { name: "x", description: "", instructions_markdown: "새 보고서를 만든다.", capabilities: ["document-create"] };
  assert.equal(applySkillDraft(INITIAL_SKILL_CREATE_FORM, draft).resultMode, "create");
  assert.equal(applySkillDraft(INITIAL_SKILL_CREATE_FORM, { ...draft, capabilities: [] }).resultMode, "auto");
  assert.equal(applySkillDraft({ ...INITIAL_SKILL_CREATE_FORM, resultMode: "edit" }, { ...draft, capabilities: [] }).resultMode, "edit");
});

const { SKILL_KIND_CARDS, SKILL_RESULT_OPTIONS, skillCreateFormFromRequest } = await import(
  "../src/features/skill-authoring/lib/skillCreateForm.ts"
);

test("스킬 종류 카드는 문서·폴더 정리 두 가지이고 결과 방식 라벨은 디자인과 같다", () => {
  assert.deepEqual(SKILL_KIND_CARDS.map((card) => card.value), ["document", "folder"]);
  assert.deepEqual(SKILL_RESULT_OPTIONS.map((option) => option.label), ["새 문서로 만들기", "열린 문서 고치기", "상황에 맞게"]);
});

test("AI 초안이 템플릿을 골라도 만들기에서 고른 종류를 유지한다", () => {
  const draft = { name: "x", description: "", instructions_markdown: "양식으로 만든다.", capabilities: ["template"] };
  const next = applySkillDraft({ ...INITIAL_SKILL_CREATE_FORM, kind: "folder" }, draft);
  assert.equal(next.kind, "folder");
  assert.equal(next.rules, "양식으로 만든다.");
});

test("Agent 요청으로 연 새 스킬은 요청을 실행 규칙에 채우고 나머지는 기본값(결과 방식 '상황에 맞게')이다", () => {
  const form = skillCreateFormFromRequest("  연구 개요를 핵심만 3문장으로 정리해 줘 ");
  assert.equal(form.rules, "연구 개요를 핵심만 3문장으로 정리해 줘");
  assert.equal(form.resultMode, "auto");
  assert.equal(form.kind, "document");
  assert.equal(form.command, "");
});
