import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, getErrorMessage, INSUFFICIENT_CREDIT_MESSAGE, isErrorMessage, isInsufficientCreditError } from "../src/shared/lib/apiErrors.ts";

test("402 INSUFFICIENT_CREDIT는 서버 문구 대신 공통 크레딧 부족 안내로 바꾼다(#153)", () => {
  const credit = new ApiError("크레딧이 부족해 작업을 시작하지 않았습니다.", 402, "INSUFFICIENT_CREDIT");
  assert.equal(isInsufficientCreditError(credit), true);
  assert.equal(getErrorMessage(credit, "실패"), INSUFFICIENT_CREDIT_MESSAGE);
  assert.equal(INSUFFICIENT_CREDIT_MESSAGE, "크레딧이 부족합니다.");
  // 다른 402나 code 없는 응답, 일반 Error는 크레딧 부족으로 보지 않는다.
  assert.equal(isInsufficientCreditError(new ApiError("결제 필요", 402)), false);
  assert.equal(isInsufficientCreditError(new ApiError("거절", 403, "INSUFFICIENT_CREDIT")), false);
  assert.equal(isInsufficientCreditError(new Error("INSUFFICIENT_CREDIT")), false);
  assert.equal(getErrorMessage(new ApiError("결제 필요", 402), "실패"), "결제 필요");
});

test("AI 설정 오류와 분류 오류를 사용자 입력 오류로 안내하지 않는다", () => {
  assert.equal(getErrorMessage(new Error("agent_not_configured"), "실패"),
    "서버 설정으로 인해 AI 작업 기능을 사용할 수 없습니다. 관리자에게 문의해 주세요.");
  assert.equal(getErrorMessage(new Error("agent_turn_route_contract_failed"), "실패"),
    "AI의 작업 분류 응답을 처리하지 못했습니다. 다시 시도해 주세요.");
  assert.equal(getErrorMessage(new Error("다른 오류"), "실패"), "다른 오류");
  assert.equal(getErrorMessage(null, "실패"), "실패");
});

test("일치하는 Error 메시지만 인증 오류로 판별한다", () => {
  assert.equal(isErrorMessage(new Error("로그인이 필요합니다."), "로그인이 필요합니다."), true);
});

test("다른 오류와 Error가 아닌 값은 인증 오류로 판별하지 않는다", () => {
  assert.equal(isErrorMessage(new Error("서버에 연결할 수 없습니다."), "로그인이 필요합니다."), false);
  assert.equal(isErrorMessage("로그인이 필요합니다.", "로그인이 필요합니다."), false);
});
