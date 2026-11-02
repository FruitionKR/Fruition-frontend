import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });

const {
  AI_CONCURRENT_LIMIT_MESSAGE,
  AI_DAILY_LIMIT_MESSAGE,
  ApiError,
  getErrorMessage,
  isAiUsageLimitError,
  UPLOAD_LIMIT_MESSAGES,
  usageLimitMessage
} = await import("../src/shared/lib/apiErrors.ts");
const { parseApiError } = await import("../src/shared/api/client.ts");
const {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_SAVE_MAX,
  DOCUMENT_DIRECT_UPLOAD_MAX_BYTES,
  DOCUMENT_FORM_UPLOAD_MAX_BYTES,
  MEETING_RECORDING_MAX_BYTES,
  SPEECH_MAX_BYTES,
  uploadSizeLimitMessage
} = await import("../src/shared/config/uploadLimits.ts");

const MIB = 1024 * 1024;
const errorBody = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

test("AI 사용량 한도: 하루 비용·토큰 한도와 모르는 값은 하루 한도 안내, CONCURRENT는 동시 실행 안내", () => {
  const code = "AI_USAGE_LIMIT_EXCEEDED";
  assert.equal(usageLimitMessage(code, { limit_type: "DAILY_COST" }), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(usageLimitMessage(code, { limit_type: "DAILY_TOKENS" }), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(usageLimitMessage(code, { limit_type: "SOMETHING_NEW" }), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(usageLimitMessage(code, {}), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(usageLimitMessage(code), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(usageLimitMessage(code, { limit_type: "CONCURRENT" }), AI_CONCURRENT_LIMIT_MESSAGE);
  assert.equal(usageLimitMessage(code, { limitType: "CONCURRENT" }), AI_CONCURRENT_LIMIT_MESSAGE);
});

test("하루 한도에 초기화 시각이 있으면 '내일' 대신 그 시각을 알려 주고, 잘못된 시각은 무시한다", () => {
  const withReset = usageLimitMessage("AI_USAGE_LIMIT_EXCEEDED", { limit_type: "DAILY_COST", reset_at: "2026-11-03T00:00:00+09:00" });
  assert.match(withReset, /^오늘 사용할 수 있는 AI 사용량을 모두 썼어요\. .+부터 다시 이용할 수 있어요\.$/);
  assert.doesNotMatch(withReset, /내일/);
  assert.equal(usageLimitMessage("AI_USAGE_LIMIT_EXCEEDED", { resetAt: "not-a-date" }), AI_DAILY_LIMIT_MESSAGE);
  // 동시 실행 한도는 초기화 시각과 관계없다.
  assert.equal(usageLimitMessage("AI_USAGE_LIMIT_EXCEEDED", { limit_type: "CONCURRENT", reset_at: "2026-11-03T00:00:00Z" }), AI_CONCURRENT_LIMIT_MESSAGE);
});

test("업로드 제한 code는 정해 둔 문구로, 그 밖의 code는 null로 둔다", () => {
  assert.equal(usageLimitMessage("FILE_TOO_LARGE"), UPLOAD_LIMIT_MESSAGES.FILE_TOO_LARGE);
  assert.equal(usageLimitMessage("TOO_MANY_FILES"), UPLOAD_LIMIT_MESSAGES.TOO_MANY_FILES);
  assert.equal(usageLimitMessage("UPLOAD_DAILY_LIMIT_EXCEEDED"), "오늘 올릴 수 있는 파일 수를 넘었어요. 내일 다시 올려 주세요.");
  assert.equal(usageLimitMessage("STORAGE_QUOTA_EXCEEDED"), "내 저장 공간을 모두 사용했어요. 사용하지 않는 문서를 삭제한 뒤 다시 올려 주세요.");
  // 저장 공간 한도는 서버 설정이라 숫자를 넣지 않는다.
  assert.doesNotMatch(UPLOAD_LIMIT_MESSAGES.STORAGE_QUOTA_EXCEEDED, /\d/);
  assert.equal(usageLimitMessage("OTHER"), null);
  assert.equal(usageLimitMessage(undefined), null);
});

test("parseApiError는 한도 거절의 서버 문구를 안내 문구로 바꾸고 status·code는 보존한다", async () => {
  const concurrent = await parseApiError(errorBody(429, { code: "AI_USAGE_LIMIT_EXCEEDED", message: "limit", limit_type: "CONCURRENT" }), "실패");
  assert.equal(concurrent.message, AI_CONCURRENT_LIMIT_MESSAGE);
  assert.equal(concurrent.status, 429);
  assert.equal(isAiUsageLimitError(concurrent), true);
  assert.equal(getErrorMessage(concurrent, "실패"), AI_CONCURRENT_LIMIT_MESSAGE);

  const daily = await parseApiError(errorBody(429, { code: "AI_USAGE_LIMIT_EXCEEDED", message: "limit" }), "실패");
  assert.equal(daily.message, AI_DAILY_LIMIT_MESSAGE);

  const quota = await parseApiError(errorBody(413, { code: "STORAGE_QUOTA_EXCEEDED", message: "server" }), "실패");
  assert.equal(quota.message, UPLOAD_LIMIT_MESSAGES.STORAGE_QUOTA_EXCEEDED);
  assert.equal(quota.code, "STORAGE_QUOTA_EXCEEDED");

  const other = await parseApiError(errorBody(400, { code: "INVALID_REQUEST", message: "요청 형식이 올바르지 않습니다." }), "실패");
  assert.equal(other.message, "요청 형식이 올바르지 않습니다.");
  assert.equal(isAiUsageLimitError(other), false);
  assert.equal(isAiUsageLimitError(new ApiError("x", 429)), false);
});

test("업로드 상한은 백엔드 기본값과 같다", () => {
  assert.equal(DOCUMENT_DIRECT_UPLOAD_MAX_BYTES, 100 * MIB);
  assert.equal(DOCUMENT_FORM_UPLOAD_MAX_BYTES, 50 * MIB);
  assert.equal(ATTACHMENT_MAX_BYTES, 10 * MIB);
  assert.equal(ATTACHMENTS_PER_SAVE_MAX, 20);
  assert.equal(MEETING_RECORDING_MAX_BYTES, 500 * MIB);
  assert.equal(SPEECH_MAX_BYTES, 24 * MIB);
});

test("uploadSizeLimitMessage는 상한까지는 통과시키고 넘으면 MB 단위 안내를 준다", () => {
  assert.equal(uploadSizeLimitMessage({ size: 0 }, DOCUMENT_FORM_UPLOAD_MAX_BYTES), null);
  assert.equal(uploadSizeLimitMessage({ size: DOCUMENT_FORM_UPLOAD_MAX_BYTES }, DOCUMENT_FORM_UPLOAD_MAX_BYTES), null);
  assert.equal(uploadSizeLimitMessage({ size: DOCUMENT_FORM_UPLOAD_MAX_BYTES + 1 }, DOCUMENT_FORM_UPLOAD_MAX_BYTES),
    "파일이 너무 커요. 50MB 이하 파일만 올릴 수 있어요.");
  assert.match(uploadSizeLimitMessage({ size: DOCUMENT_DIRECT_UPLOAD_MAX_BYTES + 1 }, DOCUMENT_DIRECT_UPLOAD_MAX_BYTES), /100MB 이하/);
});
