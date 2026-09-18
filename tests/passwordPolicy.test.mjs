import assert from "node:assert/strict";
import test from "node:test";
import { isPasswordAllowed } from "../src/features/user-settings/lib/passwordPolicy.ts";

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
