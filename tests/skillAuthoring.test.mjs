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
const { ApiError, SessionExpiredError } = await import("../src/shared/lib/errors.ts");
const { describeSkillAuthorError, skillAuthoringOutcome } = await import("../src/features/user-settings/lib/skillAuthoring.ts");

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
    ["SKILL_INSTRUCTION_INVALID", "참조 문서가 비어 있습니다."]
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
