import assert from "node:assert/strict";
import test from "node:test";
import { describeMeetingNotesError, describeTtsStreamError } from "../src/shared/lib/aiErrorCodes.ts";

test("답변 듣기 스트림 오류 코드를 문구로 바꾸고 모르는 코드는 기본 문구로 안내한다(#152)", () => {
  assert.equal(describeTtsStreamError("provider_unavailable"), "음성 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  assert.equal(describeTtsStreamError("provider_rate_limited"), "요청이 많아 잠시 후 다시 시도해 주세요.");
  assert.equal(describeTtsStreamError("deadline_exceeded"), "음성 생성이 지연돼 중단했습니다.");
  assert.equal(describeTtsStreamError("internal_error"), "음성을 만들지 못했습니다.");
  assert.equal(describeTtsStreamError("unknown_code"), "음성을 만들지 못했습니다.");
  assert.equal(describeTtsStreamError(undefined), "음성을 만들지 못했습니다.");
});

test("회의록 생성 실패 코드를 문구로 바꾸고 겹친 요청(BUSY)도 안내한다(#152)", () => {
  for (const code of ["MEETING_NOTES_INPUT_REJECTED", "MEETING_NOTES_UNAVAILABLE", "MEETING_NOTES_INVALID", "MEETING_NOTES_TIMEOUT", "MEETING_NOTES_CANCELLED", "MEETING_NOTES_BUSY"]) {
    const message = describeMeetingNotesError(code);
    assert.notEqual(message, "회의록을 만들지 못했습니다.");
    assert.doesNotMatch(message, /MEETING_NOTES/);
  }
  assert.equal(describeMeetingNotesError("MEETING_NOTES_FAILED"), "회의록을 만들지 못했습니다.");
  assert.equal(describeMeetingNotesError("something_else"), "회의록을 만들지 못했습니다.");
});
