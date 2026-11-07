import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

// 영어 화면에서 스킬·회의·Notion 가져오기 문구에 한국어가 섞이지 않는지 확인한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const { createTranslator } = await import("use-intl/core");
const messages = (namespace) => JSON.parse(readFileSync(new URL(`../src/shared/i18n/messages/en/${namespace}.json`, import.meta.url), "utf8"));
const translator = (namespace) => createTranslator({ locale: "en", messages: { [namespace]: messages(namespace) }, namespace });
const tsEn = translator("shared");
const tSkills = translator("skills");
const tMeeting = translator("meeting");
const tImport = translator("notionImport");

const { ApiError } = await import("../src/shared/lib/apiErrors.ts");
const { describeSkillAuthorError, describeSkillSaveError } = await import("../src/features/skill-authoring/lib/skillAuthoring.ts");
const { describeSkillTestRunError } = await import("../src/features/skill-authoring/lib/skillTestRun.ts");
const { describeSkillReferenceUploadError } = await import("../src/features/skill-authoring/lib/referenceDocumentPicker.ts");
const { describeLiveError } = await import("../src/features/meeting-dictation/lib/liveProtocol.ts");
const { describeMeetingMicrophoneError, describeNotesRequestError, describeNotesSaveError, describeRecordingError } =
  await import("../src/features/meeting-dictation/lib/meetingNotesFlow.ts");
const { resumedMeetingView } = await import("../src/features/meeting-dictation/lib/meetingResume.ts");
const { checkRecordingFile, MEETING_RECORDING_MAX_BYTES } = await import("../src/entities/meeting/lib/recordingFile.ts");
const { importErrorMessage } = await import("../src/features/notion-import/model/importRunner.ts");
const { describeZipSafetyError } = await import("../src/features/notion-import/lib/zipSafetyMessage.ts");
const { assertSafeEntry, readZipArchive, ZipSafetyError } = await import("../src/shared/lib/markdown-import/zipArchive.ts");

const HANGUL = /[가-힣]/;
const assertEnglish = (text) => {
  assert.equal(typeof text, "string");
  assert.ok(text.length > 0);
  assert.doesNotMatch(text, HANGUL, text);
};

const credit = new ApiError("크레딧이 부족합니다.", 402, "INSUFFICIENT_CREDIT");
const forbidden = new ApiError("이 작업에는 'EDIT' 권한이 필요합니다.", 403, "WORKSPACE_PERMISSION_REQUIRED");
const timeout = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });

test("스킬 오류 문구는 영어 화면에서 크레딧·권한·연결 오류도 영어로 보여 준다", () => {
  const author = describeSkillAuthorError(credit, tSkills, tsEn);
  assertEnglish(author.title);
  assertEnglish(author.description);
  assert.equal(author.description, tsEn("errors.insufficientCredit"));
  assertEnglish(describeSkillTestRunError(credit, tSkills, tsEn));
  assertEnglish(describeSkillSaveError(timeout, tSkills, tsEn));
  assertEnglish(describeSkillReferenceUploadError(new ApiError("저장 공간", 413, "STORAGE_QUOTA_EXCEEDED"), tSkills, tsEn));
});

test("회의 오류 문구는 영어 화면에서 공용 문구까지 영어로 고른다", () => {
  assertEnglish(describeLiveError("ai_usage_limit_exceeded", tMeeting, tsEn));
  assertEnglish(describeLiveError("모르는_코드", tMeeting, tsEn));
  assertEnglish(describeRecordingError(credit, tMeeting("errors.uploadFailed"), tsEn));
  assertEnglish(describeNotesRequestError(new ApiError("", 409, "MEETING_NOTES_BUSY"), tMeeting, tsEn).message);
  assertEnglish(describeNotesRequestError(timeout, tMeeting, tsEn).message);
  assertEnglish(describeNotesSaveError(forbidden, tMeeting("errors.applyFailed"), tMeeting, tsEn));
  for (const name of ["NotAllowedError", "NotFoundError", "Other"]) {
    assertEnglish(describeMeetingMicrophoneError(Object.assign(new Error("x"), { name }), tMeeting));
  }
});

test("다시 연 회의의 실패 안내는 영어 화면에서 영어로 나온다", () => {
  const meeting = { status: "failed", source: "upload", error: null, segments: [], live_connected: false };
  assertEnglish(resumedMeetingView(meeting, null, tMeeting, tsEn).notice.text);
  const open = { ...meeting, status: "open" };
  assertEnglish(resumedMeetingView(open, { status: "failed", error_code: "MEETING_NOTES_CANCELLED" }, tMeeting, tsEn).notice.text);
});

test("올릴 수 없는 녹음 파일은 사유 코드를 주고 화면이 영어 문구로 바꾼다", () => {
  const file = (name, type, size) => ({ name, type, size });
  for (const checked of [
    checkRecordingFile(file("a.mp4", "video/mp4", 10)),
    checkRecordingFile(file("a.wav", "audio/wav", 0)),
    checkRecordingFile(file("a.wav", "audio/wav", MEETING_RECORDING_MAX_BYTES + 1))
  ]) {
    assert.equal(checked.ok, false);
    assertEnglish(tMeeting(`recordingFile.${checked.reason}`));
  }
});

test("Notion 가져오기 오류는 영어 화면에서 공용 문구·zip 안전 검사 문구 모두 영어다", async () => {
  assertEnglish(importErrorMessage(credit, tImport("errors.startFailed"), tImport, tsEn));
  assertEnglish(importErrorMessage(new ApiError("x", 404, "IMPORT_NOT_FOUND"), "x", tImport, tsEn));

  const unsafe = (() => {
    try {
      assertSafeEntry({ path: "../evil.md", flags: 0, method: 8, compressedSize: 1, size: 1, isSymlink: false });
    } catch (error) {
      return error;
    }
  })();
  assert.ok(unsafe instanceof ZipSafetyError);
  assert.equal(unsafe.kind, "unsafePath");
  const message = describeZipSafetyError(unsafe, tImport);
  assertEnglish(message);
  assert.ok(message.endsWith("../evil.md"));

  const unreadable = await readZipArchive(new Uint8Array([1, 2, 3])).catch((error) => error);
  assert.ok(unreadable instanceof ZipSafetyError);
  assertEnglish(describeZipSafetyError(unreadable, tImport));
  assertEnglish(describeZipSafetyError({ kind: "tooManyEntries" }, tImport));
});
