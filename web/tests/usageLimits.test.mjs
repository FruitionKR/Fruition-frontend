import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });

const {
  AI_DAILY_LIMIT_MESSAGE,
  aiUsageLimitMessage,
  ApiError,
  formatResetTime,
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

test("AI 사용량 한도: 하루 토큰 한도와 모르는 limit_type·없음은 모두 하루 한도 안내", () => {
  const code = "AI_USAGE_LIMIT_EXCEEDED";
  assert.equal(usageLimitMessage(code, { limit_type: "DAILY_TOKENS" }), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(usageLimitMessage(code, { limitType: "DAILY_TOKENS" }), AI_DAILY_LIMIT_MESSAGE);
  // 이전 서버가 보내던 값이나 새로 생길 값도 안전하게 하루 한도 안내로 둔다.
  assert.equal(usageLimitMessage(code, { limit_type: "CONCURRENT" }), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(usageLimitMessage(code, { limit_type: "SOMETHING_NEW" }), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(usageLimitMessage(code, {}), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(usageLimitMessage(code), AI_DAILY_LIMIT_MESSAGE);
});

test("초기화 시각은 한국 시간으로: 다음 날 0시는 '내일(11월 3일) 0시', 그 밖은 날짜와 오전·오후 시각", () => {
  // 한국 시간 11월 2일 오후 3시(UTC 06:00)
  const now = new Date("2026-11-02T06:00:00Z");
  const message = aiUsageLimitMessage({ limit_type: "DAILY_TOKENS", reset_at: "2026-11-03T00:00:00+09:00" }, now);
  assert.equal(message, "오늘 사용할 수 있는 AI 사용량을 모두 썼어요. 내일(11월 3일) 0시부터 다시 이용할 수 있어요.");
  // UTC로 같은 순간을 보내도 한국 시간으로 읽는다.
  assert.equal(formatResetTime("2026-11-02T15:00:00Z", now), "내일(11월 3일) 0시");
  // 한국 시간 자정 직전(11월 2일 23:30)에도 다음 날 0시는 내일이다.
  assert.equal(formatResetTime("2026-11-03T00:00:00+09:00", new Date("2026-11-02T14:30:00Z")), "내일(11월 3일) 0시");
  // 다음 날이 아닌 0시와 0시가 아닌 시각
  assert.equal(formatResetTime("2026-11-05T00:00:00+09:00", now), "11월 5일 0시");
  assert.equal(formatResetTime("2026-11-03T15:00:00+09:00", now), "11월 3일 오후 3:00");
  assert.doesNotMatch(message, /오전 12:00/);
});

test("잘못된 초기화 시각은 무시한다", () => {
  assert.equal(usageLimitMessage("AI_USAGE_LIMIT_EXCEEDED", { resetAt: "not-a-date" }), AI_DAILY_LIMIT_MESSAGE);
});

test("비동기 실패(회의록 error_code·문서 error_message·실시간 받아쓰기 종료 사유)도 하루 한도 안내를 쓴다", async () => {
  const { AI_USAGE_LIMIT_FAILURE_MESSAGE, describeDocumentFailure, describeMeetingNotesError } = await import("../src/shared/lib/aiErrorCodes.ts");
  const { describeLiveError, isFatalLiveError } = await import("../src/features/meeting-dictation/lib/liveProtocol.ts");
  assert.equal(AI_USAGE_LIMIT_FAILURE_MESSAGE, AI_DAILY_LIMIT_MESSAGE);
  assert.equal(describeMeetingNotesError("AI_USAGE_LIMIT_EXCEEDED"), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(describeDocumentFailure("AI 사용 한도에 도달해 작업을 시작하지 않았습니다. 잠시 후 또는 내일 다시 시도해 주세요."), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(describeDocumentFailure("AI_USAGE_LIMIT_EXCEEDED"), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(describeDocumentFailure("페이지를 추출하지 못했습니다."), "페이지를 추출하지 못했습니다.");
  assert.equal(describeDocumentFailure(undefined), undefined);
  // 서버가 error_code를 주면 문구와 관계없이 코드로 판정한다. 문구 비교는 이전 서버 응답용 대체 경로다.
  assert.equal(describeDocumentFailure("문구가 바뀐 한도 안내", "AI_USAGE_LIMIT_EXCEEDED"), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(describeDocumentFailure(undefined, "AI_USAGE_LIMIT_EXCEEDED"), AI_DAILY_LIMIT_MESSAGE);
  assert.equal(describeDocumentFailure("크레딧이 부족해 작업을 시작하지 않았습니다.", "INSUFFICIENT_CREDIT"), "크레딧이 부족해 작업을 시작하지 않았습니다.");
  assert.equal(describeDocumentFailure("페이지를 추출하지 못했습니다.", null), "페이지를 추출하지 못했습니다.");
  // AI 사용 한도는 meeting 메시지를 쓰지 않고 앱 공통 안내를 그대로 쓴다.
  assert.equal(describeLiveError("ai_usage_limit_exceeded", () => "meeting 메시지"), AI_DAILY_LIMIT_MESSAGE);
  // 다시 연결해도 같은 결과라 재연결하지 않는다.
  assert.equal(isFatalLiveError("ai_usage_limit_exceeded"), true);
});

test("업로드 실패 알림 문구는 파일 이름과 사유를 함께 보인다", async () => {
  const { useTranslations: koT } = await import("./fakeNextIntl.mjs");
  assert.equal(koT("documents.upload.failed")("message", { filename: "big.pdf", reason: "파일이 너무 커요. 100MB 이하 파일만 올릴 수 있어요." }),
    '"big.pdf" 파일을 올리지 못했어요. 파일이 너무 커요. 100MB 이하 파일만 올릴 수 있어요.');
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
  const tokens = await parseApiError(errorBody(429, { code: "AI_USAGE_LIMIT_EXCEEDED", message: "limit", limit_type: "DAILY_TOKENS", reset_at: "2026-11-03T00:00:00+09:00" }), "실패");
  assert.match(tokens.message, /^오늘 사용할 수 있는 AI 사용량을 모두 썼어요\. .+0시부터 다시 이용할 수 있어요\.$/);
  assert.equal(tokens.status, 429);
  assert.equal(isAiUsageLimitError(tokens), true);
  assert.equal(getErrorMessage(tokens, "실패"), tokens.message);

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

test("업로드가 거절된 자리표시 행은 경고 아이콘으로 표시하고, 서버 문서가 있는 실패 행은 건드리지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const { runInNewContext } = await import("node:vm");
  const ts = (await import("typescript")).default;
  const source = readFileSync(new URL("../src/widgets/document-sidebar/ui/TreeNodeIcon.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  const element = (type, props) => ({ type, props });
  const modules = {
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "@/entities/tree": { isFileItem: (item) => item.type === "file" },
    "@/shared/ui/SvgIcon": { fileIcon: "", sourceIcon: "", SvgIcon: () => null },
    "@/shared/lib/classNames": { cx: (...names) => names.filter(Boolean).join(" ") },
    "./SidebarIcons": { SidebarChevronIcon: () => null },
    "./DocumentSidebar.module.css": { default: { "tree-folder-slot": "slot", "tree-upload-failed-icon": "failed-icon", "tree-upload-spinner": "spinner" } }
  };
  runInNewContext(outputText, { exports, require: (name) => modules[name] });
  const failed = { id: "u1", label: "big.pdf", type: "file", status: "failed" };
  assert.equal(exports.isUploadFailedItem(failed), true);
  assert.equal(exports.isUploadFailedItem({ ...failed, documentId: "doc_1" }), false);
  assert.equal(exports.isUploadFailedItem({ ...failed, status: "uploading" }), false);
  const icon = exports.TreeNodeIcon({ item: failed, isExpandable: false, isOpen: false });
  assert.equal(icon.props.className, "slot failed-icon");
  assert.equal(icon.props.children.type, "svg");
});
