import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });
const { MISSING_SNAPSHOTS_TO_DROP, getPdfIngestTaskStep } = await import("../src/features/wiki-ingest/model/pdfIngestTask.ts");

function makeDocument(overrides) {
  return {
    id: "doc-1",
    filename: "note.md",
    mime_type: "text/markdown",
    byte_size: 10,
    status: "completed",
    source_uri: "s3://bucket/doc-1",
    uploaded_at: "2026-08-16T00:00:00Z",
    document_role: "EDITABLE",
    ...overrides
  };
}

test("변환 중인 placeholder는 기다린다", () => {
  assert.equal(getPdfIngestTaskStep(makeDocument({ status: "processing" }), 0), "waiting");
  assert.equal(getPdfIngestTaskStep(makeDocument({ processing_state: "stalled" }), 0), "waiting");
});

test("변환이 끝난 placeholder는 편입을 요청한다", () => {
  const converted = makeDocument({ pipeline_run_id: "convert:doc-1" });
  assert.equal(getPdfIngestTaskStep(converted, 0), "ready");
});

test("변환이 실패한 placeholder는 편입하지 않고 끝낸다", () => {
  const failed = makeDocument({ status: "failed", error_message: "페이지 묶음 변환 실패" });
  assert.equal(getPdfIngestTaskStep(failed, 0), "failed");
});

test("목록에 없는 placeholder는 첫 갱신까지 기다리고 두 번째 갱신에서 종료한다", () => {
  assert.equal(getPdfIngestTaskStep(undefined, 0), "waiting");
  assert.equal(getPdfIngestTaskStep(undefined, MISSING_SNAPSHOTS_TO_DROP - 1), "waiting");
  assert.equal(getPdfIngestTaskStep(undefined, MISSING_SNAPSHOTS_TO_DROP), "missing");
});

test("성공·실패·유실이 섞인 묶음은 모두 종료 단계에 도달한다", () => {
  const documents = [
    makeDocument({ id: "md-ok", pipeline_run_id: "convert:md-ok" }),
    makeDocument({ id: "pdf-failed", status: "failed", error_message: "페이지 묶음 변환 실패" })
  ];
  const tasks = ["md-ok", "pdf-failed", "pdf-gone"];
  const steps = tasks.map((id) => getPdfIngestTaskStep(
    documents.find((document) => document.id === id),
    MISSING_SNAPSHOTS_TO_DROP
  ));
  assert.deepEqual(steps, ["ready", "failed", "missing"]);
  assert.ok(steps.every((step) => step !== "waiting"));
});
