import assert from "node:assert/strict";
import test from "node:test";
import { shouldRequestWikiLint } from "../src/features/document-notifications/model/wikiLintStatus.ts";
import { ko } from "./fakeNextIntl.mjs";

test("Wiki가 최신이면 lint 실행 요청을 만들지 않는다", () => {
  assert.equal(shouldRequestWikiLint(false), false);
  // 최신 상태 안내 문구(알림 설정 '위키 최신 상태 안내'의 제목과 같다)
  assert.equal(ko("wiki.notifications.upToDate.title"), "Wiki 최신 상태");
  assert.equal(ko("wiki.notifications.upToDate.message"), "Wiki가 이미 최신 상태입니다.");
});

test("Wiki 변경이 있으면 lint 실행 요청을 허용한다", () => {
  assert.equal(shouldRequestWikiLint(true), true);
});
