import assert from "node:assert/strict";
import test from "node:test";

const { getCenteredScrollTop } = await import("../src/widgets/source-preview/lib/centerScrollTop.ts");

const container = (scrollTop = 0) => ({ top: 100, scrollTop, scrollHeight: 3000, clientHeight: 600 });

test("블록을 컨테이너 가운데로 맞추는 위치를 계산한다", () => {
  // 컨테이너 기준 1000px 아래, 높이 100px 블록 → 1000 - (600 - 100) / 2
  assert.equal(getCenteredScrollTop(container(), { top: 1100, height: 100 }), 750);
});

test("이미 스크롤된 상태면 현재 위치를 더해 계산한다", () => {
  assert.equal(getCenteredScrollTop(container(400), { top: 700, height: 100 }), 750);
});

test("문서 앞쪽 블록은 0보다 위로 스크롤하지 않는다", () => {
  assert.equal(getCenteredScrollTop(container(), { top: 150, height: 40 }), 0);
});

test("문서 끝쪽 블록은 최대 스크롤 위치를 넘지 않는다", () => {
  assert.equal(getCenteredScrollTop(container(), { top: 3000, height: 100 }), 2400);
});

test("내용이 컨테이너보다 짧으면 0을 돌려준다", () => {
  const short = { top: 0, scrollTop: 0, scrollHeight: 300, clientHeight: 600 };
  assert.equal(getCenteredScrollTop(short, { top: 200, height: 50 }), 0);
});
