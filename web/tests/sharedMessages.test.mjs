import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { translator } from "./helpers/i18nMessages.mjs";

// Node 테스트에서도 앱의 TypeScript 경로 별칭을 같은 소스로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    // 앱 소스의 확장자 없는 상대 import(./apiErrors)도 .ts로 찾는다.
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

const apiErrors = await import("../src/shared/lib/apiErrors.ts");
const aiErrorCodes = await import("../src/shared/lib/aiErrorCodes.ts");
const { getPasswordPolicyError } = await import("../src/shared/lib/passwordPolicy.ts");
const { formatRelativeTime } = await import("../src/shared/lib/relativeTime.ts");
const { WORKSPACE_PERMISSIONS, localizedWorkspacePermissions } = await import("../src/shared/lib/workspacePermissions.ts");
const { verificationCodeLabel } = await import("../src/shared/lib/developmentVerificationCode.ts");
const { accountDeletionErrorMessage } = await import("../src/entities/user/model/accountDeletion.ts");
const { emailChangeFailure, emailCodeRequestFailureMessage } = await import("../src/entities/user/model/emailChange.ts");
const { passwordChangeFailure } = await import("../src/entities/user/model/passwordChange.ts");
const { verificationWaitMessage } = await import("../src/entities/user/model/verificationWait.ts");
const { consentErrorMessage } = await import("../src/entities/user/model/consent.ts");
const oauth = await import("../src/entities/user/model/oauthLink.ts");
const { avatarInitial, avatarUploadErrorMessage, validateAvatarFile } = await import("../src/entities/user/lib/avatarFile.ts");
const aiUsage = await import("../src/entities/ai/model/aiUsage.ts");
const { getAiModelLockMessage } = await import("../src/entities/ai/model/aiModel.ts");
const trash = await import("../src/entities/document/lib/trashRetention.ts");
const { registerSharedTranslate, sharedText } = await import("../src/shared/i18n/sharedTranslate.ts");

const ko = translator("ko", "shared");
const en = translator("en", "shared");
const HANGUL = /[가-힣]/;
const { ApiError } = apiErrors;

/**
 * 같은 호출을 번역 함수 없이(기존 한국어), ko 메시지, en 메시지로 부른다.
 * 한국어 문구가 JSON으로 옮겨져도 화면 문구가 바뀌지 않았는지(ko === 기본), 영어에 한국어가 남지 않았는지 본다.
 */
function assertLocalized(name, call) {
  const fallback = call(undefined);
  assert.equal(call(ko), fallback, `${name}: ko 메시지가 기존 한국어 문구와 같다`);
  const english = call(en);
  assert.doesNotMatch(String(english), HANGUL, `${name}: 영어 문구에 한국어가 없다 (${english})`);
  return english;
}

const apiError = (status, code, message = "server") => new ApiError(message, status, code);

test("apiErrors의 앱 문구를 공용 메시지로 지금 언어에 맞게 고른다", () => {
  const cases = {
    chatLimit: apiError(409, "CHAT_SESSION_LIMIT_EXCEEDED"),
    credit: apiError(402, "INSUFFICIENT_CREDIT"),
    permission: apiError(403, "WORKSPACE_PERMISSION_REQUIRED", "required 'wiki.ingest'"),
    permissionUnknown: apiError(403, "WORKSPACE_PERMISSION_REQUIRED", "required"),
    workspace: apiError(404, "WORKSPACE_NOT_FOUND"),
    agent: new Error("agent_not_configured"),
    route: new Error("agent_turn_route_contract_failed"),
    timeout: Object.assign(new Error("signal timed out"), { name: "TimeoutError" }),
    aborted: Object.assign(new Error("aborted"), { name: "AbortError" }),
    lost: new TypeError("Failed to fetch")
  };
  for (const [name, error] of Object.entries(cases)) assertLocalized(name, (t) => apiErrors.getErrorMessage(error, "fallback", t));
  assert.equal(apiErrors.getErrorMessage(cases.permission, "x", en), "This action requires the 'Add to wiki' permission. Ask a workspace OWNER to grant it.");
  // 앱이 정하지 않은 실패는 서버가 언어에 맞춰 준 message를 그대로 둔다.
  assert.equal(apiErrors.getErrorMessage(apiError(500, "X", "Server said"), "fallback", en), "Server said");
  for (const code of Object.keys(apiErrors.UPLOAD_LIMIT_MESSAGES)) assertLocalized(code, (t) => apiErrors.usageLimitMessage(code, null, t));
  assert.equal(apiErrors.usageLimitMessage("UNKNOWN", null, en), null);
});

test("AI 하루 한도 초기화 시각을 언어와 서울 시간대에 맞춰 쓴다", () => {
  const now = new Date("2026-11-02T03:00:00Z"); // 서울 11월 2일 낮
  const tomorrow = { reset_at: "2026-11-02T15:00:00Z" }; // 서울 11월 3일 0시
  const later = { reset_at: "2026-11-04T15:00:00Z" };
  const afternoon = { reset_at: "2026-11-03T06:00:00Z" }; // 서울 11월 3일 15:00
  for (const detail of [null, tomorrow, later, afternoon]) {
    assertLocalized(JSON.stringify(detail), (t) => apiErrors.aiUsageLimitMessage(detail, now, t));
  }
  assert.equal(apiErrors.aiUsageLimitMessage(tomorrow, now, en), "You've used all of today's AI usage. You can use AI again from midnight tomorrow (Nov 3).");
  assert.equal(apiErrors.formatResetTime(afternoon.reset_at, now, en), "Nov 3, 3:00 PM");
});

test("권한 라벨·설명을 지금 언어로 만들고 순서는 그대로 둔다", () => {
  assert.deepEqual(localizedWorkspacePermissions(ko), WORKSPACE_PERMISSIONS);
  const english = localizedWorkspacePermissions(en);
  assert.deepEqual(english.map((item) => item.value), WORKSPACE_PERMISSIONS.map((item) => item.value));
  for (const item of english) assert.doesNotMatch(item.label + item.description, HANGUL);
  assert.equal(apiErrors.localizedWorkspacePermissionLabel("wiki.lint", en), "Refresh wiki");
  assert.equal(apiErrors.localizedWorkspacePermissionLabel("future.permission", en), "future.permission");
});

test("AI 실패 코드 문구를 코드로 번역하고, error_code 없는 옛 한국어 문서 실패도 영어로 바꾼다", () => {
  for (const code of ["provider_unavailable", "provider_rate_limited", "deadline_exceeded", "internal_error", "unknown", null]) {
    assertLocalized(`tts ${code}`, (t) => aiErrorCodes.describeTtsStreamError(code, t));
  }
  for (const code of ["MEETING_NOTES_INPUT_REJECTED", "MEETING_NOTES_UNAVAILABLE", "MEETING_NOTES_FAILED", "MEETING_NOTES_INVALID", "MEETING_NOTES_TIMEOUT", "MEETING_NOTES_CANCELLED", "MEETING_NOTES_BUSY", "INSUFFICIENT_CREDIT", "AI_USAGE_LIMIT_EXCEEDED", "toString", undefined]) {
    assertLocalized(`notes ${code}`, (t) => aiErrorCodes.describeMeetingNotesError(code, t));
  }
  for (const code of ["MEETING_RECORDING_TOO_LARGE", "MEETING_RECORDING_UNSUPPORTED", "MEETING_RECORDING_EMPTY", "MEETING_RECORDING_SIZE_MISMATCH", "MEETING_UPLOAD_REJECTED", "MEETING_RECORDING_NOT_ALLOWED", "MEETING_LIVE_IN_USE", "MEETING_NOT_TRANSCRIBING", "MEETING_TRANSCRIBING", "MEETING_RECORDING_CHANGED", "MEETING_RECORDING_NOT_FOUND", "MEETING_RECORDING_STORAGE_FAILED", "MEETING_NOT_FOUND"]) {
    assertLocalized(`recording ${code}`, (t) => aiErrorCodes.describeMeetingRecordingError(code, t));
  }
  assert.equal(aiErrorCodes.describeMeetingRecordingError("OTHER", en), null);
  assertLocalized("transcription", (t) => aiErrorCodes.describeMeetingTranscriptionFailure(null, t));

  const legacy = "AI 사용 한도에 도달해 작업을 시작하지 않았습니다. 잠시 후 또는 내일 다시 시도해 주세요.";
  assertLocalized("document code", (t) => aiErrorCodes.describeDocumentFailure("저장된 한국어", "AI_USAGE_LIMIT_EXCEEDED", t));
  assertLocalized("document legacy", (t) => aiErrorCodes.describeDocumentFailure(legacy, null, t));
  // 앱이 모르는 실패 사유는 서버가 준 문구를 그대로 둔다.
  assert.equal(aiErrorCodes.describeDocumentFailure("Server reason", "OTHER", en), "Server reason");
});

test("비밀번호 정책·인증번호 라벨·시도 제한 안내를 지금 언어로 쓴다", () => {
  for (const password of ["short", "a".repeat(80), "abcdefgh"]) assertLocalized(password, (t) => getPasswordPolicyError(password, t));
  assert.equal(getPasswordPolicyError("abcd1234", en), null);
  assertLocalized("production", (t) => verificationCodeLabel("production", t));
  assertLocalized("development", (t) => verificationCodeLabel("development", t));
  for (const seconds of [1, 30, 61, 3600, 3700]) assertLocalized(`wait ${seconds}`, (t) => verificationWaitMessage(seconds, t));
  assert.equal(verificationWaitMessage(1, en), "Too many verification requests. Please try again in 1 second.");
  assert.equal(verificationWaitMessage(3700, en), "Too many verification requests. Please try again in 1 hour 2 minutes.");
});

test("상대 시간을 언어와 복수형에 맞춰 쓴다", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-07T00:00:00Z") });
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  const minute = 60_000;
  const day = 24 * 60 * minute;
  for (const ms of [0, minute, 5 * minute, 60 * minute, day, 8 * day, 40 * day, 400 * day]) {
    assertLocalized(`relative ${ms}`, (t) => formatRelativeTime(ago(ms), t));
  }
  assert.equal(formatRelativeTime(ago(minute), en), "1 minute ago");
  assert.equal(formatRelativeTime(ago(3 * day), en), "3 days ago");
});

test("계정 모델의 오류 안내를 서버 code로 지금 언어에 맞게 고른다", () => {
  for (const code of ["INVALID_CREDENTIALS", "INVALID_MFA_CODE", "REAUTHENTICATION_REQUIRED", "SOLE_OWNER_OF_SHARED_WORKSPACE"]) {
    assertLocalized(code, (t) => accountDeletionErrorMessage({ code }, "fallback", t));
  }
  assertLocalized("deletion 429", (t) => accountDeletionErrorMessage({ status: 429 }, "fallback", t));

  const emailCodes = ["INVALID_REQUEST", "DUPLICATE_EMAIL", "INVALID_VERIFICATION_TOKEN", "INVALID_CREDENTIALS", "INVALID_MFA_CODE", "REAUTHENTICATION_REQUIRED", "PASSWORD_CHANGE_RATE_LIMITED", "MFA_RATE_LIMITED"];
  for (const code of emailCodes) assertLocalized(code, (t) => emailChangeFailure({ code, retryAfter: 30 }, "fallback", t).message);
  assertLocalized("email 429", (t) => emailChangeFailure({ status: 429 }, "fallback", t).message);
  assert.deepEqual(emailChangeFailure({ code: "MFA_RATE_LIMITED", retryAfter: 1 }, "x", en), {
    recovery: "wait", message: "Too many authentication code attempts. Please try again in 1 second.", retryAfter: 1
  });
  assertLocalized("email code request", (t) => emailCodeRequestFailureMessage({ code: "DUPLICATE_EMAIL" }, t));

  const passwordCodes = ["PASSWORD_LOGIN_UNAVAILABLE", "INVALID_VERIFICATION_TOKEN", "INVALID_MFA_CODE", "VERIFICATION_RATE_LIMITED", "MFA_RATE_LIMITED", "EMAIL_SEND_FAILED"];
  for (const code of passwordCodes) assertLocalized(code, (t) => passwordChangeFailure({ code, retryAfter: 30 }, "fallback", t).message);
  assert.equal(passwordChangeFailure({ code: "EMAIL_SEND_FAILED" }, "x", en).recovery, "retry");

  for (const code of ["CONSENT_REQUIRED", "INVALID_SIGNUP_TOKEN"]) assertLocalized(code, (t) => consentErrorMessage({ code }, "fallback", t));
});

test("소셜 계정 안내를 지금 언어와 provider 이름으로 쓴다", () => {
  for (const option of oauth.OAUTH_PROVIDER_OPTIONS) assertLocalized(option.provider, (t) => oauth.oauthProviderName(option.provider, t));
  for (const code of ["UNSUPPORTED_OAUTH_PROVIDER", "INVALID_OAUTH_LINK_CODE", "OAUTH_ACCOUNT_ALREADY_LINKED", "OAUTH_ACCOUNT_NOT_FOUND", "OAUTH_UNLINK_NOT_ALLOWED"]) {
    assertLocalized(code, (t) => oauth.oauthAccountErrorMessage({ code }, "fallback", t));
  }
  for (const providers of [["local"], ["kakao", "google"]]) assertLocalized(providers.join(), (t) => oauth.registeredEmailLoginMessage(providers, t));
  assert.equal(oauth.registeredEmailLoginMessage(["kakao", "naver"], en), "This email is already registered with Kakao, Naver. Sign in with Kakao, Naver, then link it in Settings > User settings.");
  assertLocalized("duplicate", (t) => oauth.signupAvailabilityMessage({ available: false }, t));
  assertLocalized("registered error", (t) => oauth.registeredEmailErrorMessage({ code: "EMAIL_REGISTERED", providers: [] }, t));
  assertLocalized("callback registered", (t) => oauth.oauthCallbackErrorMessage({ kind: "email_registered", providers: [] }, t));
  assertLocalized("callback failed", (t) => oauth.oauthCallbackErrorMessage({ kind: "failed" }, t));
  assert.equal(ko("user.oauth.linkSuccess"), oauth.OAUTH_LINK_SUCCESS_MESSAGE);
  assert.equal(ko("user.oauth.linkFailed"), oauth.OAUTH_LINK_FAILED_MESSAGE);
  assert.equal(ko("user.oauth.unlinkGuide"), oauth.OAUTH_UNLINK_GUIDE);
});

test("프로필 사진 안내와 이름 없는 사용자의 이니셜을 지금 언어로 쓴다", () => {
  for (const file of [{ size: 0, type: "image/png" }, { size: 10, type: "text/plain" }, { size: 2 * 1024 * 1024, type: "image/png" }]) {
    assertLocalized(JSON.stringify(file), (t) => validateAvatarFile(file, t));
  }
  assertLocalized("server 400", (t) => avatarUploadErrorMessage(apiError(400, "UNSUPPORTED_USER_AVATAR"), "fallback", t));
  assertLocalized("server 413", (t) => avatarUploadErrorMessage(apiError(413, "USER_AVATAR_TOO_LARGE"), "fallback", t));
  assert.equal(avatarInitial("", en), "U");
  assert.equal(avatarInitial("", ko), avatarInitial(""));
});

test("AI 사용량·모델 잠금 문구를 지금 언어로 쓴다", () => {
  assert.deepEqual(aiUsage.localizedAiUsagePeriodOptions(ko), aiUsage.AI_USAGE_PERIOD_OPTIONS);
  for (const option of aiUsage.localizedAiUsagePeriodOptions(en)) assert.doesNotMatch(option.label, HANGUL);
  assertLocalized("less than", (t) => aiUsage.formatKrwMilli(100, t));
  for (const row of [{ audioSeconds: 5, ttsCharacters: 0 }, { audioSeconds: 125, ttsCharacters: 1800 }, { audioSeconds: 120, ttsCharacters: 0 }]) {
    assertLocalized(JSON.stringify(row), (t) => aiUsage.formatNonTokenUsage(row, t));
  }
  assert.equal(aiUsage.formatNonTokenUsage({ audioSeconds: 125, ttsCharacters: 1800 }, en), "Audio 2m 5s · 1,800 chars");
  assert.equal(aiUsage.formatCompactTokenCount(78_257, "en"), "78.3K");
  assert.equal(aiUsage.formatCompactTokenCount(78_257), "7.8만");
  for (const reason of ["cost_policy", "workspace_claude"]) assertLocalized(reason, (t) => getAiModelLockMessage(reason, t));
});

test("휴지통 보관 기간·복구 안내를 지금 언어로 쓴다", () => {
  const now = Date.parse("2026-11-07T00:00:00Z");
  for (const purgeAt of [null, "2026-11-06T00:00:00Z", "2026-11-08T00:00:00Z", "2026-11-12T00:00:00Z"]) {
    assertLocalized(`purge ${purgeAt}`, (t) => trash.describePurge(purgeAt, now, t));
  }
  assert.equal(trash.describePurge("2026-11-12T00:00:00Z", now, en), "Will be permanently deleted in 5 days.");
  for (const error of [apiError(409, "TRASH_RETENTION_EXPIRED"), apiError(409, "WORKSPACE_TRASH_EXPIRED"), apiError(403, "X"), apiError(409, "X"), "not an error"]) {
    assertLocalized(`restore ${String(error)}`, (t) => trash.describeRestoreError(error, undefined, t));
  }
  for (const folder of [undefined, null, "보관함"]) assertLocalized(`restored ${folder}`, (t) => trash.documentRestoredMessage("A", folder, t).replace("보관함", "Box"));
});

test("hook 없는 API 기본 오류 문구는 브라우저에 등록된 공용 번역 함수를 따른다", () => {
  // 등록 전(서버 렌더·테스트)에는 넘긴 한국어를 쓴다. 서버(window 없음)에서는 등록도 하지 않는다.
  registerSharedTranslate(en);
  assert.equal(sharedText("autoApproval.loadFailed", "자동 승인 설정을 불러오지 못했습니다."), "자동 승인 설정을 불러오지 못했습니다.");
  assert.equal(ko("autoApproval.loadFailed"), "자동 승인 설정을 불러오지 못했습니다.");

  globalThis.window = {};
  try {
    registerSharedTranslate(en);
    assert.equal(sharedText("autoApproval.loadFailed", "자동 승인 설정을 불러오지 못했습니다."), "We couldn't load the auto-approval settings.");
  } finally {
    registerSharedTranslate(null);
    delete globalThis.window;
  }
});
