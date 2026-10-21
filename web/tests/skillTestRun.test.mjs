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

const { INITIAL_SKILL_CREATE_FORM } = await import("../src/features/skill-authoring/lib/skillCreateForm.ts");
const {
  describeSkillTestRunError,
  newSkillTestRunId,
  skillTestRunBlocker,
  skillTestRunRequest,
  skillTestRunView
} = await import("../src/features/skill-authoring/lib/skillTestRun.ts");
const { ApiError, INSUFFICIENT_CREDIT_MESSAGE } = await import("../src/shared/lib/apiErrors.ts");

const form = {
  ...INITIAL_SKILL_CREATE_FORM,
  resultMode: "edit",
  command: " research-summary ",
  description: " 연구 개요를 정리합니다. ",
  rules: " '연구 개요' 섹션만 고친다. "
};
const documentId = "doc_1";

test("테스트 요청은 시트 정의와 문서만 담고 target을 보내지 않아 문서 전체에 적용한다", () => {
  assert.deepEqual(skillTestRunRequest(form, documentId), {
    name: "research-summary",
    description: "연구 개요를 정리합니다.",
    instructions_markdown: "'연구 개요' 섹션만 고친다.",
    capabilities: ["document-edit"],
    document_id: "doc_1"
  });
  assert.ok(!("target" in skillTestRunRequest(form, documentId)));
  assert.ok(!("allowed_tools" in skillTestRunRequest(form, documentId)));
});

test("run_id는 매번 새로 만들고 서버 형식을 따른다", () => {
  const first = newSkillTestRunId();
  assert.match(first, /^[a-zA-Z0-9:_-]{1,120}$/);
  assert.notEqual(first, newSkillTestRunId());
});

test("폴더 정리·빈 필드·문서 미선택이면 테스트를 시작하지 않는다", () => {
  assert.equal(skillTestRunBlocker(form, documentId), null);
  assert.match(skillTestRunBlocker({ ...form, kind: "folder" }, documentId), /폴더 정리/);
  assert.match(skillTestRunBlocker({ ...form, command: "" }, documentId), /커맨드명/);
  assert.match(skillTestRunBlocker(form, ""), /문서를 골라/);
});

test("테스트 실행 capability는 고른 결과 방식을 따른다(기본 '상황에 맞게'는 수정 결과로 본다)", () => {
  const base = { ...form, resultMode: INITIAL_SKILL_CREATE_FORM.resultMode };
  assert.deepEqual(skillTestRunRequest(base, documentId).capabilities, ["document-create", "document-edit"]);
  assert.deepEqual(skillTestRunRequest({ ...form, resultMode: "edit" }, documentId).capabilities, ["document-edit"]);
  assert.deepEqual(skillTestRunRequest({ ...form, resultMode: "create" }, documentId).capabilities, ["document-create"]);
});

test("응답을 변경/생성/변경 없음/차단 화면으로 나눈다", () => {
  const base = { run_id: "r", status: "completed", changes: [], untouched_sections: [], result_markdown: null, issues: [] };
  const change = { section: "연구 개요", start_line: 1, end_line: 6, before: "a", after: "b" };
  assert.deepEqual(skillTestRunView({ ...base, changes: [change], untouched_sections: ["방법"] }, ["document-edit"]), {
    kind: "changes",
    changes: [change],
    untouchedSections: ["방법"]
  });
  assert.deepEqual(skillTestRunView({ ...base, result_markdown: "# 새 문서" }, ["document-create"]), { kind: "created", markdown: "# 새 문서" });
  // 편집형은 바뀐 곳이 없어도 원문 전체가 result_markdown으로 온다.
  assert.deepEqual(
    skillTestRunView({ ...base, result_markdown: "# 원문", untouched_sections: ["원문"] }, ["document-create", "document-edit"]),
    { kind: "unchanged", untouchedSections: ["원문"] }
  );
  assert.deepEqual(skillTestRunView({ ...base, status: "blocked", issues: [{ category: "secret" }] }, ["document-edit"]), {
    kind: "blocked",
    issues: [{ category: "secret" }]
  });
});

test("테스트 실행 오류를 사유별 안내로 바꾼다", () => {
  const api = (status, code) => new ApiError("서버 메시지", status, code);
  assert.ok(describeSkillTestRunError(api(402, "INSUFFICIENT_CREDIT")).includes(INSUFFICIENT_CREDIT_MESSAGE));
  assert.match(describeSkillTestRunError(api(503, "SKILL_TEST_RUN_UNAVAILABLE")), /아직 사용할 수 없/);
  assert.match(describeSkillTestRunError(api(503, "SKILL_AI_UNAVAILABLE")), /응답하지 않습니다/);
  assert.match(describeSkillTestRunError(api(400, "SKILL_TEST_RUN_UNSUPPORTED")), /지원하지 않아요/);
  assert.match(describeSkillTestRunError(api(400, "INVALID_REQUEST")), /Markdown 문서만/);
  assert.match(describeSkillTestRunError(api(409)), /다시 테스트/);
  assert.match(describeSkillTestRunError(api(413, "MARKDOWN_CONTENT_TOO_LARGE")), /5MB/);
  assert.match(describeSkillTestRunError(new DOMException("timeout", "TimeoutError")), /오래 걸려/);
  assert.match(describeSkillTestRunError(new TypeError("fetch failed")), /응답하지 않습니다/);
});

const { skillChangeDiffLines, supportsSkillTestRun } = await import("../src/features/skill-authoring/lib/skillTestRun.ts");
const { rulesPlaceholderHint, RULES_PLACEHOLDER_HINT } = await import("../src/features/skill-authoring/lib/skillCreateForm.ts");

test("섹션 변경 전후는 바뀐 줄만 지움·추가로, 그대로인 줄은 맥락으로 비교한다", () => {
  const before = "## 연구 개요\n첫 문장\n둘째 문장\n셋째 문장";
  const after = "## 연구 개요\n첫 문장\n둘째 문장 (요약)\n셋째 문장";
  assert.deepEqual(skillChangeDiffLines({ before, after }), [
    { type: "context", text: "## 연구 개요" },
    { type: "context", text: "첫 문장" },
    { type: "delete", text: "둘째 문장" },
    { type: "insert", text: "둘째 문장 (요약)" },
    { type: "context", text: "셋째 문장" }
  ]);
});

test("빈 변경 전·후는 빈 줄 하나와 비교하지 않고 전부 추가·삭제로 보여 준다", () => {
  assert.deepEqual(skillChangeDiffLines({ before: "", after: "새 줄\n둘째" }), [
    { type: "insert", text: "새 줄" },
    { type: "insert", text: "둘째" }
  ]);
  assert.deepEqual(skillChangeDiffLines({ before: "지울 줄", after: "" }), [{ type: "delete", text: "지울 줄" }]);
  assert.deepEqual(skillChangeDiffLines({ before: "", after: "" }), []);
});

test("폴더 정리 스킬은 테스트 실행과 문서·선택 부분 자리표시자 안내를 감춘다", () => {
  assert.equal(supportsSkillTestRun("folder"), false);
  assert.equal(supportsSkillTestRun("document"), true);
  assert.equal(supportsSkillTestRun("template"), true);
  assert.equal(rulesPlaceholderHint("folder"), null);
  assert.equal(rulesPlaceholderHint("document"), RULES_PLACEHOLDER_HINT);
  assert.equal(rulesPlaceholderHint(null), RULES_PLACEHOLDER_HINT);
});
