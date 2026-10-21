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

test("브라우저의 영어 연결 오류(signal timed out 등)는 그대로 보여 주지 않고 한국어로 바꾼다", async () => {
  const { CONNECTION_LOST_MESSAGE, REQUEST_ABORTED_MESSAGE, REQUEST_TIMEOUT_MESSAGE } = await import("../src/shared/lib/apiErrors.ts");
  assert.equal(getErrorMessage(new DOMException("signal timed out", "TimeoutError"), "실패"), REQUEST_TIMEOUT_MESSAGE);
  assert.equal(getErrorMessage(new Error("signal timed out"), "실패"), REQUEST_TIMEOUT_MESSAGE);
  assert.equal(getErrorMessage(new DOMException("The operation was aborted.", "AbortError"), "실패"), REQUEST_ABORTED_MESSAGE);
  assert.equal(getErrorMessage(new TypeError("Failed to fetch"), "실패"), CONNECTION_LOST_MESSAGE);
  assert.equal(getErrorMessage(new TypeError("network error"), "실패"), CONNECTION_LOST_MESSAGE);
  // 한국어 서버 문구와 다른 TypeError는 그대로 둔다.
  assert.equal(getErrorMessage(new Error("문서를 찾을 수 없습니다."), "실패"), "문서를 찾을 수 없습니다.");
  assert.equal(getErrorMessage(new TypeError("x is not a function"), "실패"), "x is not a function");
});

test("404 WORKSPACE_NOT_FOUND는 id가 담긴 서버 문구 대신 접근할 수 없다는 안내로 바꾼다", async () => {
  const { WORKSPACE_NOT_FOUND_MESSAGE } = await import("../src/shared/lib/apiErrors.ts");
  assert.equal(getErrorMessage(new ApiError("워크스페이스를 찾을 수 없습니다: id=ws_1", 404, "WORKSPACE_NOT_FOUND"), "실패"), WORKSPACE_NOT_FOUND_MESSAGE);
  assert.equal(getErrorMessage(new ApiError("문서를 찾을 수 없습니다.", 404, "DOCUMENT_NOT_FOUND"), "실패"), "문서를 찾을 수 없습니다.");
});
