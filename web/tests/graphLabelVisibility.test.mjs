import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });

const { initialGraphZoom, isSmallGraphViewport, pickVisibleLabels } = await import("../src/widgets/graph/lib/graphLabelVisibility.ts");

const box = (id, x, priority = 0) => ({ id, left: x, top: 0, right: x + 40, bottom: 14, priority });

test("겹치는 라벨은 우선순위가 높은 쪽만 남긴다", () => {
  const visible = pickVisibleLabels([box("raw", 0, 0), box("source", 10, 2)]);
  assert.deepEqual([...visible], ["source"]);
});

test("겹치지 않으면 모두 남긴다", () => {
  assert.equal(pickVisibleLabels([box("a", 0), box("b", 100), box("c", 200)]).size, 3);
});

test("우선순위가 같으면 앞선 노드를 남겨 프레임마다 뒤바뀌지 않는다", () => {
  assert.deepEqual([...pickVisibleLabels([box("first", 0), box("second", 10)])], ["first"]);
});

test("다른 노드와 겹치는 라벨은 빼고, 자기 노드와 닿는 것은 빼지 않는다", () => {
  const label = box("a", 0);
  assert.deepEqual([...pickVisibleLabels([label], [{ id: "b", x: 20, y: 7, radius: 6 }])], []);
  assert.deepEqual([...pickVisibleLabels([label], [{ id: "a", x: 20, y: 7, radius: 6 }])], ["a"]);
  // 라벨 상자 모서리 밖에 있는 노드는 겹치지 않는다.
  assert.deepEqual([...pickVisibleLabels([label], [{ id: "b", x: 48, y: 22, radius: 6 }])], ["a"]);
});

test("빠진 라벨은 다른 라벨의 자리를 막지 않는다", () => {
  const visible = pickVisibleLabels([box("covered", 0, 2), box("free", 10, 0)], [{ id: "x", x: 2, y: 7, radius: 4 }]);
  assert.deepEqual([...visible], ["free"]);
});

test("누른 노드의 라벨은 다른 노드와 겹쳐도 남긴다", () => {
  const pressed = { ...box("a", 0), isPinned: true };
  assert.deepEqual([...pickVisibleLabels([pressed], [{ id: "b", x: 20, y: 7, radius: 6 }])], ["a"]);
});

test("입력 배열을 바꾸지 않는다", () => {
  const labels = [box("a", 0, 0), box("b", 100, 2)];
  pickVisibleLabels(labels);
  assert.deepEqual(labels.map((label) => label.id), ["a", "b"]);
});

test("휴대폰 크기의 그래프 화면만 작은 화면으로 본다", () => {
  assert.equal(isSmallGraphViewport({ width: 320, height: 420 }), true);
  assert.equal(isSmallGraphViewport({ width: 844, height: 240 }), true);
  assert.equal(isSmallGraphViewport({ width: 768, height: 900 }), false);
  assert.equal(isSmallGraphViewport({ width: 1100, height: 800 }), false);
});

test("큰 화면의 첫 배율은 1로 그대로 둔다", () => {
  assert.equal(initialGraphZoom({ width: 1100, height: 800 }), 1);
});

test("작은 화면의 첫 배율은 1보다 크고 최대 배율을 넘지 않는다", () => {
  const phone = initialGraphZoom({ width: 320, height: 420 });
  assert.ok(phone > 1 && phone <= 3.2);
  assert.ok(initialGraphZoom({ width: 844, height: 170 }) <= 3.2);
});
