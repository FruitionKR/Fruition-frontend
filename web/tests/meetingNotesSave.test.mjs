import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  }
});

const { ApiError } = await import("../src/shared/lib/apiErrors.ts");
const {
  findAppliedNotes,
  meetingDocumentBaseName,
  MAX_NAME_ATTEMPTS,
  numberedMeetingDocumentName,
  saveNotesUnderUniqueName
} = await import("../src/features/meeting-dictation/lib/meetingNotesSave.ts");
const { describeNotesSaveError } = await import("../src/features/meeting-dictation/lib/meetingNotesFlow.ts");

// 화면과 같이 meeting 메시지 키를 한국어 문구로 바꿔 문구까지 확인한다.
const { readFileSync: readMeetingMessages } = await import("node:fs");
const { createTranslator: createMeetingTranslator } = await import("use-intl/core");
const meetingKo = JSON.parse(readMeetingMessages(new URL("../src/shared/i18n/messages/ko/meeting.json", import.meta.url), "utf8"));
const tm = createMeetingTranslator({ locale: "ko", messages: { meeting: meetingKo }, namespace: "meeting" });

const duplicateName = () => new ApiError("같은 이름", 409, "DUPLICATE_NAME");
const startedAt = new Date(2026, 10, 4, 9, 5).toISOString();

function saver(outcomes) {
  const calls = [];
  const keys = ["k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9", "k10", "k11", "k12"];
  let attempt = { nameIndex: 0, key: "k1" };
  return {
    calls,
    current: () => attempt,
    run: (input = {}) => saveNotesUnderUniqueName({
      baseName: "회의록",
      attempt,
      createKey: () => keys.shift(),
      onAttemptChange: (next) => { attempt = next; },
      save: async (name, key) => {
        calls.push([name, key]);
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
      ...input
    })
  };
}

test("이름을 정하지 않은 실시간 회의는 시작 시각으로 이름을 만든다", () => {
  assert.equal(meetingDocumentBaseName("회의록", startedAt), "회의록 2026-11-04 09시 05분");
  assert.equal(meetingDocumentBaseName("  ", startedAt), "회의록 2026-11-04 09시 05분");
  assert.equal(meetingDocumentBaseName(null, startedAt), "회의록 2026-11-04 09시 05분");
});

test("올린 녹음 파일처럼 이름이 있는 회의는 그 이름을 쓴다", () => {
  assert.equal(meetingDocumentBaseName("  주간 회의  ", startedAt), "주간 회의");
});

test("시작 시각을 읽을 수 없으면 기본 이름만 쓴다", () => {
  assert.equal(meetingDocumentBaseName("회의록", "not-a-date"), "회의록");
});

test("문서 이름에 쓸 수 없는 문자는 공백으로 바꾸고, 번호를 붙일 자리를 남겨 줄인다", () => {
  assert.equal(meetingDocumentBaseName("2026/11/04\\회의\n정리", startedAt), "2026 11 04 회의 정리");
  const long = meetingDocumentBaseName("가".repeat(400), startedAt);
  assert.equal(long.length, 200);
  assert.ok(`${numberedMeetingDocumentName(long, 99)}.md`.length <= 255);
});

test("첫 시도는 이름 그대로, 다음부터는 (2)부터 번호를 붙인다", () => {
  assert.equal(numberedMeetingDocumentName("회의록", 0), "회의록");
  assert.equal(numberedMeetingDocumentName("회의록", 1), "회의록 (2)");
  assert.equal(numberedMeetingDocumentName("회의록", 9), "회의록 (10)");
});

test("이름이 겹치면 번호와 새 키로 다시 보내고 저장 결과를 돌려준다", async () => {
  const s = saver([duplicateName(), duplicateName(), { status: "applied" }]);
  assert.deepEqual(await s.run(), { status: "applied" });
  assert.deepEqual(s.calls, [["회의록", "k1"], ["회의록 (2)", "k2"], ["회의록 (3)", "k3"]]);
});

test("이름이 계속 겹쳐도 한 번에 정해진 횟수까지만 보낸다", async () => {
  const s = saver(Array.from({ length: 20 }, duplicateName));
  await assert.rejects(s.run(), (error) => error.code === "DUPLICATE_NAME");
  assert.equal(s.calls.length, MAX_NAME_ATTEMPTS);
  assert.equal(MAX_NAME_ATTEMPTS, 10);
});

test("횟수를 다 쓴 뒤 다시 누르면 처음 번호로 돌아가지 않고 이어 간다", async () => {
  const s = saver([...Array.from({ length: MAX_NAME_ATTEMPTS }, duplicateName), { status: "applied" }]);
  await assert.rejects(s.run());
  assert.deepEqual(await s.run(), { status: "applied" });
  assert.equal(s.calls.at(-1)[0], "회의록 (11)");
});

test("이름 중복이 아닌 오류는 재시도하지 않고, 다음 저장은 같은 이름·같은 키로 보내 중복 생성을 막는다", async () => {
  const s = saver([new TypeError("Failed to fetch"), { status: "applied" }]);
  await assert.rejects(s.run(), TypeError);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.current(), { nameIndex: 0, key: "k1" });
  await s.run();
  assert.deepEqual(s.calls, [["회의록", "k1"], ["회의록", "k1"]]);
});

test("다른 409(이미 저장됨)는 이름 중복으로 보지 않는다", async () => {
  const s = saver([new ApiError("x", 409, "MEETING_NOTES_ALREADY_APPLIED")]);
  await assert.rejects(s.run(), (error) => error.code === "MEETING_NOTES_ALREADY_APPLIED");
  assert.equal(s.calls.length, 1);
});

test("저장 실패 뒤 최신 회의록이 applied면 그 회의록을 돌려준다", async () => {
  const applied = { status: "applied", applied: { document_id: "doc_1" } };
  assert.equal(await findAppliedNotes(async () => applied), applied);
});

test("최신 회의록이 applied가 아니거나 조회에 실패하면 저장된 것으로 보지 않는다", async () => {
  assert.equal(await findAppliedNotes(async () => ({ status: "ready", applied: null })), null);
  assert.equal(await findAppliedNotes(async () => ({ status: "applied", applied: null })), null);
  assert.equal(await findAppliedNotes(async () => { throw new TypeError("Failed to fetch"); }), null);
});

test("이름 중복·이미 저장됨 오류 문구는 실제 상태와 다음 행동을 알려 준다", () => {
  assert.equal(describeNotesSaveError(duplicateName(), "f", tm), tm("messages.duplicateName"));
  assert.match(tm("messages.duplicateName"), /다음 번호/);
  assert.match(tm("messages.alreadyApplied"), /저장하는 중/);
});
