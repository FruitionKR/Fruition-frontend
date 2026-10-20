import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { hasBeenIngestedToWiki, ingestPromptMessage, selectIngestPromptTargets } = await import(
  "../src/features/document-notifications/model/ingestPromptTargets.ts"
);

const doc = (id, status = "uploaded", overrides = {}) => ({
  id, filename: `${id}.md`, mime_type: "text/markdown", status, document_role: "EDITABLE", ...overrides
});

test("카드 대상은 목록에 남아 있고 아직 편입을 시작할 수 있는 문서만, 카드의 순서대로 고른다", () => {
  const documents = [
    doc("c"),
    doc("a", "uploaded", { filename: "새 이름.md" }),
    doc("busy", "processing"),
    doc("done", "completed"),
    doc("edited", "completed", { needs_reingest: true }),
    doc("pdf", "uploaded", { mime_type: "application/pdf" })
  ];
  const targets = selectIngestPromptTargets(["a", "deleted", "busy", "done", "edited", "pdf", "c"], documents);

  assert.deepEqual(targets.map((document) => document.id), ["a", "edited", "c"]);
  assert.equal(targets[0].filename, "새 이름.md");
});

test("문구는 1개면 문서 이름, 여러 개면 개수를 보여 준다", () => {
  assert.equal(ingestPromptMessage([doc("a")]), '"a.md" 문서의 위키 편입을 시작해 보세요.');
  assert.equal(ingestPromptMessage([doc("a"), doc("b")]), "2개 문서의 위키 편입을 시작해 보세요.");
});

test("편입한 적 있는 문서만 재편입 대상이다 (uploaded·PDF 변환만 끝난 문서는 아니다)", () => {
  assert.equal(hasBeenIngestedToWiki(doc("n", "uploaded")), false);
  assert.equal(hasBeenIngestedToWiki(doc("c", "completed", { pipeline_run_id: "convert:c" })), false);
  assert.equal(hasBeenIngestedToWiki(doc("i", "completed", { pipeline_run_id: "run_1" })), true);
  assert.equal(hasBeenIngestedToWiki(doc("legacy", "completed")), true);
});
