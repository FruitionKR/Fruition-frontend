import assert from "node:assert/strict";
import test from "node:test";

const { newAttentionKeys, revealScrollDelta } = await import("../src/features/agent-chat/lib/revealScroll.ts");

const container = { top: 100, bottom: 600 };

test("카드가 이미 다 보이면 굴리지 않는다", () => {
  assert.equal(revealScrollDelta(container, { top: 200, bottom: 400 }, 10), 0);
});

test("목록 아래로 잘린 카드는 카드 아래 끝(+여백)까지 보이게 내린다", () => {
  assert.equal(revealScrollDelta(container, { top: 500, bottom: 700 }, 10), 110);
});

test("목록 위로 잘린 카드는 카드 머리(+여백)가 보이게 올린다", () => {
  assert.equal(revealScrollDelta(container, { top: 50, bottom: 300 }, 10), -60);
});

test("목록보다 큰 카드는 머리글이 보이게 맞춘다", () => {
  assert.equal(revealScrollDelta(container, { top: 400, bottom: 1200 }, 10), 290);
});

test("새로 생긴 카드 key만 지금 순서대로 고른다", () => {
  assert.deepEqual(newAttentionKeys(new Set(["a", "b"]), ["a", "c", "b", "pending"]), ["c", "pending"]);
  assert.deepEqual(newAttentionKeys(new Set(["a"]), ["a"]), []);
});
