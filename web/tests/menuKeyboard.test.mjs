import assert from "node:assert/strict";
import test from "node:test";
import { nextMenuItemIndex } from "../src/widgets/document-sidebar/model/menuKeyboard.ts";

test("ArrowDown·ArrowUp은 다음·이전 항목으로 가고 끝에서 반대쪽으로 넘어간다", () => {
  assert.equal(nextMenuItemIndex("ArrowDown", 0, 3), 1);
  assert.equal(nextMenuItemIndex("ArrowDown", 2, 3), 0);
  assert.equal(nextMenuItemIndex("ArrowUp", 0, 3), 2);
  assert.equal(nextMenuItemIndex("ArrowUp", 2, 3), 1);
});

test("Home·End는 처음·끝 항목으로 간다", () => {
  assert.equal(nextMenuItemIndex("Home", 2, 3), 0);
  assert.equal(nextMenuItemIndex("End", 0, 3), 2);
});

test("메뉴 안에 포커스가 없으면 ArrowDown은 첫 항목, ArrowUp은 마지막 항목으로 간다", () => {
  assert.equal(nextMenuItemIndex("ArrowDown", -1, 3), 0);
  assert.equal(nextMenuItemIndex("ArrowUp", -1, 3), 2);
});

test("메뉴 이동 키가 아니거나 항목이 없으면 null", () => {
  assert.equal(nextMenuItemIndex("Enter", 0, 3), null);
  assert.equal(nextMenuItemIndex("Tab", 0, 3), null);
  assert.equal(nextMenuItemIndex("ArrowDown", -1, 0), null);
});
