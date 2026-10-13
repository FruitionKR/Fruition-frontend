import assert from "node:assert/strict";
import test from "node:test";
import { getPasswordPolicyError, hasHangul, isPasswordAllowed } from "../src/shared/lib/passwordPolicy.ts";

test("15자 이상이면 문자만으로도 허용한다", () => {
  assert.equal(isPasswordAllowed("abcdefghijklmno"), true);
});

test("8자 이상이면 문자와 숫자를 모두 포함해야 한다", () => {
  assert.equal(isPasswordAllowed("abcd1234"), true);
  assert.equal(isPasswordAllowed("abcdefgh"), false);
  assert.equal(isPasswordAllowed("12345678"), false);
  assert.equal(isPasswordAllowed("abc123"), false);
});

test("72자를 넘으면 거부한다", () => {
  assert.equal(isPasswordAllowed("a1".repeat(37)), false);
});

test("허용되는 비밀번호는 안내 문구가 없다", () => {
  assert.equal(getPasswordPolicyError("abcd1234"), null);
  assert.equal(getPasswordPolicyError("abcdefghijklmno"), null);
  assert.equal(getPasswordPolicyError("1".repeat(15)), null);
});

test("8자 미만이면 길이 안내를 준다", () => {
  assert.equal(getPasswordPolicyError("abc123"), "비밀번호는 8자 이상 입력해주세요.");
});

test("8~14자에서 영문과 숫자가 섞이지 않으면 조합 안내를 준다", () => {
  assert.equal(getPasswordPolicyError("abcdefgh"), "영어, 숫자 조합으로 입력해주세요.");
  assert.equal(getPasswordPolicyError("12345678901234"), "영어, 숫자 조합으로 입력해주세요.");
});

test("72자를 넘으면 최대 길이 안내를 준다", () => {
  assert.equal(getPasswordPolicyError("a1".repeat(37)), "비밀번호는 72자 이하로 입력해주세요.");
});

test("비밀번호에 한글(완성형·자모)이 섞이면 한/영 경고 대상으로 본다", () => {
  assert.equal(hasHangul("password1"), false);
  assert.equal(hasHangul("p@ss w0rd!"), false);
  assert.equal(hasHangul("비밀번호123"), true);
  assert.equal(hasHangul("passㅈ"), true);
  assert.equal(hasHangul("ᄒ"), true);
});
