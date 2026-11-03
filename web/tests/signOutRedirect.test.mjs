import assert from "node:assert/strict";
import test from "node:test";

import { signOutDestination } from "../src/entities/user/model/signOutDestination.ts";
import { isSignedOutByUser, markSignedOutByUser, saveAccessToken } from "../src/shared/lib/authSessionStorage.ts";

test("사용자가 직접 로그아웃하면 랜딩으로 보낸다", () => {
  assert.equal(signOutDestination("user"), "/");
});

test("세션 만료·인증 실패·사유 없는 종료는 로그인 화면으로 보낸다", () => {
  assert.equal(signOutDestination("reauth"), "/login");
  assert.equal(signOutDestination(), "/login");
});

test("직접 로그아웃 표시는 다시 로그인해 토큰을 받으면 풀린다", () => {
  globalThis.window = { localStorage: { removeItem: () => {} } };
  markSignedOutByUser();
  assert.equal(isSignedOutByUser(), true);

  saveAccessToken("next-access");

  assert.equal(isSignedOutByUser(), false);
});
