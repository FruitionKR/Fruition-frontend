import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  }
});

const { versionMergeStatusLabel } = await import("../src/features/note-editing/api/versions.ts");

test("버전 목록의 merge_status를 자동 병합 표시로 바꾼다", () => {
  assert.equal(versionMergeStatusLabel("merged"), "자동 병합");
  assert.equal(versionMergeStatusLabel("overwritten"), "덮어씀");
  assert.equal(versionMergeStatusLabel("conflict_archived"), "충돌 보관본");
  assert.equal(versionMergeStatusLabel(null), null);
  assert.equal(versionMergeStatusLabel(undefined), null);
  assert.equal(versionMergeStatusLabel("unknown"), null);
});
