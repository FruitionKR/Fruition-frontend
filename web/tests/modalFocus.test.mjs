import assert from "node:assert/strict";
import test from "node:test";

const { wrapFocusIndex } = await import("../src/shared/hooks/useModalFocus.ts");

test("모달 마지막 요소에서 Tab을 누르면 처음으로 돌아간다", () => {
  assert.equal(wrapFocusIndex(2, 3, false), 0);
  assert.equal(wrapFocusIndex(0, 3, false), null);
});

test("모달 첫 요소에서 Shift+Tab을 누르면 마지막으로 간다", () => {
  assert.equal(wrapFocusIndex(0, 3, true), 2);
  assert.equal(wrapFocusIndex(1, 3, true), null);
});

test("포커스가 모달 밖에 있으면 모달 안으로 데려온다", () => {
  assert.equal(wrapFocusIndex(-1, 3, false), 0);
  assert.equal(wrapFocusIndex(-1, 3, true), 2);
  assert.equal(wrapFocusIndex(-1, 0, false), null);
});
