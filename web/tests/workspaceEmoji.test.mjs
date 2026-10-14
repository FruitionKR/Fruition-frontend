import assert from "node:assert/strict";
import test from "node:test";
import { emojiPickerHint, pickEmoji } from "../src/features/user-settings/lib/workspaceEmoji.ts";

test("입력값에서 이모티콘 한 글자만 고른다", () => {
  assert.equal(pickEmoji("🚀"), "🚀");
  assert.equal(pickEmoji("🚀🎨"), "🚀");
  assert.equal(pickEmoji("팀 🌱"), "🌱");
});

test("피부색·ZWJ·국기처럼 여러 코드포인트인 이모티콘도 한 글자로 본다", () => {
  assert.equal(pickEmoji("👍🏽"), "👍🏽");
  assert.equal(pickEmoji("👨‍👩‍👧"), "👨‍👩‍👧");
  assert.equal(pickEmoji("🇰🇷"), "🇰🇷");
});

test("이모티콘이 없으면 null이다", () => {
  assert.equal(pickEmoji("abc"), null);
  assert.equal(pickEmoji(""), null);
  assert.equal(pickEmoji("  "), null);
});

test("OS별 이모티콘 선택기 단축키를 안내한다", () => {
  assert.equal(emojiPickerHint("MacIntel"), "⌃⌘Space");
  assert.equal(emojiPickerHint("Win32"), "Win + .");
  assert.equal(emojiPickerHint("Linux x86_64"), "OS 이모티콘 선택기");
});
