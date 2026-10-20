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

const { parseApiError, parseJsonOrThrow } = await import("../src/shared/api/client.ts");
const { ApiError, SessionExpiredError } = await import("../src/shared/lib/apiErrors.ts");
const { describeSkillAuthorError, describeSkillSaveError, isResultModeRejection, isSkillFormDirty, skillAuthoringOutcome, skillUpdateRequest } = await import("../src/features/skill-authoring/lib/skillAuthoring.ts");

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("실패 응답의 error.code와 status를 ApiError에 보존한다", async () => {
  const error = await parseApiError(
    jsonResponse(400, { error: { code: "SKILL_REQUEST_REJECTED", message: "Skill 요청이 거부되었습니다." } }),
    "실패"
  );
  assert.ok(error instanceof ApiError);
  assert.ok(error instanceof Error);
  assert.equal(error.message, "Skill 요청이 거부되었습니다.");
  assert.equal(error.status, 400);
  assert.equal(error.code, "SKILL_REQUEST_REJECTED");
});

test("본문이 JSON이 아니면 fallback 문구와 status만 담는다", async () => {
  const error = await parseApiError(new Response("Bad Gateway", { status: 502 }), "실패");
  assert.equal(error.message, "실패");
  assert.equal(error.status, 502);
  assert.equal(error.code, undefined);
});

test("parseJsonOrThrow는 기존 메시지를 유지한 ApiError를 던진다", async () => {
  await assert.rejects(
    parseJsonOrThrow(jsonResponse(503, { error: { code: "SKILL_AI_UNAVAILABLE", message: "AI 서버 오류" } }), "실패"),
    (error) => error instanceof ApiError && error.message === "AI 서버 오류" && error.code === "SKILL_AI_UNAVAILABLE"
  );
});

test("크레딧 부족(402 INSUFFICIENT_CREDIT)은 거절이 아니라 공통 문의 안내로 보여 준다(#153)", async () => {
  const error = await parseApiError(jsonResponse(402, { error: { code: "INSUFFICIENT_CREDIT", message: "크레딧이 부족해 작업을 시작하지 않았습니다." } }), "실패");
  const notice = describeSkillAuthorError(error);
  assert.equal(notice.title, "스킬 검토를 완료하지 못했습니다.");
  assert.equal(notice.description, "크레딧이 부족합니다.");
});

test("거절(400·SKILL_REQUEST_REJECTED)은 위험 표현이 아니라 중립 문구로 안내한다", () => {
  for (const error of [new ApiError("Skill 요청이 거부되었습니다.", 400, "SKILL_REQUEST_REJECTED"), new ApiError("bad", 400)]) {
    const notice = describeSkillAuthorError(error);
    assert.equal(notice.title, "스킬 검토 요청이 거부되었습니다.");
    assert.match(notice.description, /구체적으로/);
    assert.doesNotMatch(notice.description, /위험한 표현/);
  }
});

test("사유 code(의도 불명확·지침 오류)는 응답 파싱을 거친 서버 message를 그대로 보여준다", async () => {
  const cases = [
    ["SKILL_INTENT_AMBIGUOUS", "어떤 작업을 반복할지 구체적으로 적어 주세요."],
    ["SKILL_INSTRUCTION_INVALID", "참조 문서를 확인해 주세요. 접근할 수 없거나 비어 있거나 너무 긴 문서가 있습니다."]
  ];
  for (const [code, message] of cases) {
    const error = await parseApiError(jsonResponse(400, { error: { code, message } }), "스킬 초안을 생성하지 못했습니다.");
    const notice = describeSkillAuthorError(error);
    assert.equal(notice.title, "스킬 검토 요청이 거부되었습니다.");
    assert.equal(notice.description, message);
  }
});

test("불가능한 작업은 서버 message와 관계없이 '불가능한 작업'으로 안내한다", () => {
  for (const message of ["지원하지 않는 작업입니다. 문서 작성·수정·폴더 정리·템플릿 중에서 골라 주세요.", ""]) {
    const notice = describeSkillAuthorError(new ApiError(message, 400, "SKILL_INTENT_UNSUPPORTED"));
    assert.equal(notice.title, "스킬 검토 요청이 거부되었습니다.");
    assert.match(notice.description, /불가능한 작업/);
    assert.doesNotMatch(notice.description, /지원하지 않는/);
  }
});

test("참고 문서 한 개가 너무 길면(413) AI의 내부 용어 대신 글자 수 제한을 안내한다", async () => {
  const error = await parseApiError(
    jsonResponse(413, { error: { code: "REFERENCE_DOCUMENT_TOO_LARGE", message: "EDITABLE 참조 문서는 30,000자 이하여야 합니다." } }),
    "스킬 초안을 생성하지 못했습니다."
  );
  const notice = describeSkillAuthorError(error);
  assert.equal(notice.title, "스킬 검토 요청이 거부되었습니다.");
  assert.match(notice.description, /30,000자/);
  assert.doesNotMatch(notice.description, /EDITABLE/);
});

test("사유 없는 거절은 상태 코드와 관계없이, 알 수 없는 400 code는 중립 문구로 안내한다", () => {
  for (const error of [
    new ApiError("Skill 요청이 거부되었습니다.", 409, "SKILL_REQUEST_REJECTED"),
    new ApiError("Skill 요청이 거부되었습니다.", 422, "SKILL_REQUEST_REJECTED"),
    new ApiError("알 수 없음", 400, "SKILL_SOMETHING_NEW")
  ]) {
    const notice = describeSkillAuthorError(error);
    assert.equal(notice.title, "스킬 검토 요청이 거부되었습니다.");
    assert.match(notice.description, /구체적으로/);
  }
});

test("AI 장애·5xx·타임아웃·네트워크 오류는 재시도 문구로 구분한다", () => {
  const errors = [
    new ApiError("x", 400, "SKILL_AI_UNAVAILABLE"),
    new ApiError("x", 500),
    new ApiError("x", 504),
    new ApiError("x", 408),
    new TypeError("Failed to fetch"),
    new DOMException("The operation was aborted.", "AbortError")
  ];
  for (const error of errors) {
    const notice = describeSkillAuthorError(error);
    assert.equal(notice.title, "스킬 검토를 완료하지 못했습니다.");
    assert.match(notice.description, /잠시 후 다시 시도/);
  }
});

test("그 밖의 4xx는 서버 메시지를, 세션 만료는 그 안내를 보여준다", () => {
  assert.equal(describeSkillAuthorError(new ApiError("권한이 없습니다.", 403)).description, "권한이 없습니다.");
  assert.equal(describeSkillAuthorError(new SessionExpiredError("로그인이 필요합니다.")).description, "로그인이 필요합니다.");
});

test("author 응답 status로 되묻기·검토·통과를 나눈다", () => {
  assert.equal(skillAuthoringOutcome({ status: "clarification_required", issues: [] }), "clarify");
  assert.equal(skillAuthoringOutcome({ status: "blocked", issues: [] }), "review");
  assert.equal(skillAuthoringOutcome({ status: "draft", issues: [{ category: "credential" }] }), "review");
  assert.equal(skillAuthoringOutcome({ status: "draft", issues: [] }), "pass");
  assert.equal(skillAuthoringOutcome({ status: "draft", issues: undefined }), "pass");
});

test("스킬 수정 요청은 상세 시트의 커맨드명을 name으로 보낸다(백엔드 name 필수, slug를 바꾼다)", () => {
  assert.deepEqual(skillUpdateRequest({ name: "meeting-notes", description: "새 설명", instructionsMarkdown: "새 지침" }), {
    name: "meeting-notes",
    description: "새 설명",
    instructions_markdown: "새 지침"
  });
});

test("스킬 수정 요청은 초안의 targets·result_mode를 담고, 없으면 키를 빼 서버가 기존 값을 유지하게 한다", () => {
  assert.deepEqual(
    skillUpdateRequest({ name: "s", description: "d", instructionsMarkdown: "i", targets: ["selection"], result_mode: "edit" }),
    { name: "s", description: "d", instructions_markdown: "i", targets: ["selection"], result_mode: "edit" }
  );
  const omitted = skillUpdateRequest({ name: "s", description: "d", instructionsMarkdown: "i" });
  assert.ok(!("targets" in omitted) && !("result_mode" in omitted));
});

test("시트 입력을 고쳤는지는 처음 값과 비교해 정한다(저장 전 닫기 확인)", () => {
  const initial = { kind: "document", targets: ["current-document"], command: "summarize", rules: "요약한다" };
  assert.equal(isSkillFormDirty(initial, { ...initial }), false);
  assert.equal(isSkillFormDirty(initial, { ...initial, rules: "요약한다." }), true);
  assert.equal(isSkillFormDirty(initial, { ...initial, targets: ["current-document", "selection"] }), true);
});

test("결과 방식 불일치 거절은 전용 code(모든 표기)이거나 document가 바꿔 돌려준 SKILL_REQUEST_REJECTED다", () => {
  for (const code of ["invalid_result_mode", "INVALID_RESULT_MODE", "SKILL_INVALID_RESULT_MODE", "SKILL_RESULT_MODE_INVALID"]) {
    assert.equal(isResultModeRejection(new ApiError("x", 400, code)), true, code);
  }
  // 결과 방식을 보내지 않은 첫 저장도, 지침 재분류로 이어받은 값이 거절되면 SKILL_REQUEST_REJECTED로 온다.
  assert.equal(isResultModeRejection(new ApiError("Skill 요청이 거부되었습니다.", 400, "SKILL_REQUEST_REJECTED")), true);
  assert.equal(isResultModeRejection(new ApiError("x", 400, "SKILL_INTENT_AMBIGUOUS")), false);
  assert.equal(isResultModeRejection(new ApiError("x", 400)), false);
  assert.equal(isResultModeRejection(new ApiError("x", 409, "invalid_result_mode")), false);
  assert.equal(isResultModeRejection(new Error("network")), false);
});

test("대상 오류(SKILL_TARGETS_INVALID)는 결과 방식 문제가 아니며 서버의 대상 안내를 보여 준다", () => {
  const error = new ApiError("선택한 부분은 이 스킬의 대상이 될 수 없습니다.", 400, "SKILL_TARGETS_INVALID");
  assert.equal(isResultModeRejection(error), false);
  assert.equal(describeSkillSaveError(error, "스킬 정의를 수정하지 못했습니다."), "선택한 부분은 이 스킬의 대상이 될 수 없습니다.");
  assert.match(describeSkillSaveError(new ApiError("스킬 정의를 수정하지 못했습니다.", 400, "SKILL_TARGETS_INVALID"), "스킬 정의를 수정하지 못했습니다."), /실행 대상/);
  assert.equal(describeSkillAuthorError(error).description, "선택한 부분은 이 스킬의 대상이 될 수 없습니다.");
  assert.equal(describeSkillSaveError(new ApiError("기타", 400, "X"), "fb"), "기타");
});
