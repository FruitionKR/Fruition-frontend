import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith(".svg")) return { url: "data:text/javascript,export default {src:''}", shortCircuit: true };
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
globalThis.window = { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
globalThis.document = { documentElement: { dataset: {}, getAttribute: () => null } };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#000000" });
globalThis.Image = class {};
const { drawGraphFrame } = await import("../src/widgets/graph/lib/graphDrawing.ts");

/** 그리기 호출 순서를 기록하는 가짜 캔버스. */
function recordingCanvas() {
  const calls = [];
  const context = new Proxy({ measureText: (text) => ({ width: text.length * 6 }) }, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => { calls.push({ name: key, args }); return { addColorStop() {} }; };
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  return { calls, canvas: { clientWidth: 320, clientHeight: 500, width: 320, height: 500, getContext: () => context } };
}

test("노드를 모두 그린 뒤 라벨을 그려 뒤 노드가 앞 노드의 라벨을 가리지 않는다", () => {
  const { calls, canvas } = recordingCanvas();
  const nodes = [{ id: "a", label: "앞 노드", kind: "concept" }, { id: "b", label: "뒤 노드", kind: "concept" }];
  const positions = { a: { x: 100, y: 100 }, b: { x: 110, y: 120 } };
  drawGraphFrame({
    canvas, nodes, links: [], visibleNodeCount: 2,
    getNodePosition: (id) => positions[id],
    nodeHoverAmounts: {},
    graphToCanvas: (position) => position,
    nodeSize: () => 14,
    isRawSourceLink: () => false
  });
  const lastArc = calls.findLastIndex((call) => call.name === "arc");
  const firstLabel = calls.findIndex((call) => call.name === "fillText");
  assert.ok(lastArc >= 0 && firstLabel >= 0);
  assert.ok(firstLabel > lastArc, `라벨(${firstLabel})이 마지막 노드(${lastArc}) 뒤에 그려져야 한다`);
  assert.deepEqual(calls.filter((call) => call.name === "fillText").map((call) => call.args[0]), ["앞 노드", "뒤 노드"]);
});
