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
  defaultSkillTestRunScope,
  describeSkillTestRunError,
  newSkillTestRunId,
  skillTestRunBlocker,
  skillTestRunRangeError,
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
const whole = { documentId: "doc_1", scope: "whole", startLine: 1, endLine: 1 };

test("테스트 요청은 시트 정의와 문서를 담고, 문서 전체면 target을 뺀다", () => {
  assert.deepEqual(skillTestRunRequest(form, whole), {
    name: "research-summary",
    description: "연구 개요를 정리합니다.",
    instructions_markdown: "'연구 개요' 섹션만 고친다.",
    capabilities: ["document-edit"],
    document_id: "doc_1"
  });
});

test("줄 범위를 고르면 selection target으로 보낸다", () => {
  const request = skillTestRunRequest(form, { documentId: "doc_1", scope: "lines", startLine: 3, endLine: 8 });
  assert.deepEqual(request.target, { type: "selection", start_line: 3, end_line: 8 });
  assert.ok(!("allowed_tools" in request));
});

test("run_id는 매번 새로 만들고 서버 형식을 따른다", () => {
  const first = newSkillTestRunId();
  assert.match(first, /^[a-zA-Z0-9:_-]{1,120}$/);
  assert.notEqual(first, newSkillTestRunId());
});

test("대상이 '선택한 부분'뿐이면 줄 범위로 시작한다", () => {
  assert.equal(defaultSkillTestRunScope(["selection"]), "lines");
  assert.equal(defaultSkillTestRunScope(["current-document", "selection"]), "whole");
  assert.equal(defaultSkillTestRunScope(["current-document"]), "whole");
});

test("줄 범위는 1 이상의 정수이고 끝이 시작보다 앞서면 막는다", () => {
  assert.equal(skillTestRunRangeError({ scope: "whole", startLine: 0, endLine: -1 }), null);
  assert.equal(skillTestRunRangeError({ scope: "lines", startLine: 2, endLine: 2 }), null);
  assert.match(skillTestRunRangeError({ scope: "lines", startLine: 0, endLine: 2 }), /1 이상/);
  assert.match(skillTestRunRangeError({ scope: "lines", startLine: Number.NaN, endLine: 2 }), /1 이상/);
  assert.match(skillTestRunRangeError({ scope: "lines", startLine: 5, endLine: 2 }), /앞설 수 없/);
});

test("폴더 정리·빈 필드·문서 미선택이면 테스트를 시작하지 않는다", () => {
  assert.equal(skillTestRunBlocker(form, whole), null);
  assert.match(skillTestRunBlocker({ ...form, kind: "folder" }, whole), /폴더 정리/);
  assert.match(skillTestRunBlocker({ ...form, command: "" }, whole), /커맨드명/);
  assert.match(skillTestRunBlocker(form, { ...whole, documentId: "" }), /문서를 골라/);
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
