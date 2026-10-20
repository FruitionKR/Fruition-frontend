import assert from "node:assert/strict";
import test from "node:test";

const { DEVELOPMENT_VERIFICATION_CODE, isDevelopmentVerificationCode } = await import("../src/shared/lib/developmentVerificationCode.ts");

test("개발 환경에서만 고정 인증번호 9700을 받는다", () => {
  assert.equal(DEVELOPMENT_VERIFICATION_CODE, "9700");
  assert.equal(isDevelopmentVerificationCode("9700", "development"), true);
  assert.equal(isDevelopmentVerificationCode(" 9700 ", "test"), true);
  assert.equal(isDevelopmentVerificationCode("9700", "production"), false, "운영은 6자리 검증만 남긴다");
  assert.equal(isDevelopmentVerificationCode("970", "development"), false);
  assert.equal(isDevelopmentVerificationCode("123456", "development"), false);
});
