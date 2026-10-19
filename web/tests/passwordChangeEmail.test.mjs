import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modalSource = readFileSync(
  new URL("../src/features/user-settings/ui/modals/PasswordChangeModal.tsx", import.meta.url),
  "utf8"
);

test("비밀번호 변경은 로그인한 계정 이메일만 읽기 전용으로 보여 주고 다른 이메일로 바꿀 수 없다", () => {
  assert.doesNotMatch(modalSource, /setEmail\(/);
  assert.match(modalSource, /id="password-change-email"[^>]*\breadOnly\b/s);
  assert.doesNotMatch(modalSource, /id="password-change-email"[^>]*onChange=/s);
});

test("인증번호 요청과 비밀번호 재설정은 로그인한 계정 이메일로 보낸다", () => {
  assert.match(modalSource, /requestEmailVerification\(accountEmail, "password_reset"\)/);
  assert.match(modalSource, /resetPasswordWithVerification\(accountEmail, newPassword, token\)/);
});
