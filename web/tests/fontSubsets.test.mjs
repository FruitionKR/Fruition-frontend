import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/app/styles/fonts.css", import.meta.url), "utf8");
const faces = [...css.matchAll(/src: url\("([^"]+)"\)[\s\S]*?unicode-range: ([^;]+);/g)].map((m) => ({ url: m[1], range: m[2] }));

function expand(range) {
  const cps = new Set();
  for (const part of range.split(",").map((s) => s.trim())) {
    const [a, b] = part.replace(/^U\+/, "").split("-").map((h) => parseInt(h, 16));
    for (let cp = a; cp <= (b ?? a); cp += 1) cps.add(cp);
  }
  return cps;
}

test("Pretendard 서브셋 파일이 모두 존재한다", () => {
  assert.ok(faces.length >= 3);
  for (const face of faces) {
    assert.ok(existsSync(new URL(`../public${face.url}`, import.meta.url)), `missing ${face.url}`);
  }
});

test("한글 음절 11,172자가 겹침 없이 서브셋 하나씩에 배정된다", () => {
  const owners = new Map();
  for (const face of faces) {
    for (const cp of expand(face.range)) {
      if (cp < 0xac00 || cp > 0xd7a3) continue;
      assert.equal(owners.has(cp), false, `U+${cp.toString(16)} in two subsets`);
      owners.set(cp, face.url);
    }
  }
  assert.equal(owners.size, 0xd7a3 - 0xac00 + 1);
  // 상용 한글(가·는·문·서·한)은 첫 화면에 미리 받는 ko-common에 있어야 한다
  for (const cp of [0xac00, 0xb294, 0xbb38, 0xc11c, 0xd55c]) assert.match(owners.get(cp), /ko-common/);
});

test("라틴 기본 문자와 공백·구두점은 latin 서브셋에 있다", () => {
  const latin = faces.find((face) => face.url.includes("-latin"));
  const cps = expand(latin.range);
  for (const ch of "Aa0 .,:;-()[]%") assert.ok(cps.has(ch.charCodeAt(0)), `missing ${JSON.stringify(ch)}`);
});
