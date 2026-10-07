import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });
const { selectGraphDocuments, filterGraphProjects, isGraphIngestEligible, getGraphIngestBlockReason, GRAPH_INGEST_BLOCK_REASONS } = await import("../src/features/wiki-ingest/model/graphDocuments.ts");

const pdf = { id: "pdf", filename: "보고서.pdf", mime_type: "application/pdf", document_role: "ORIGINAL", status: "completed" };
const md = { id: "md", filename: "이름을 바꾼 변환본.md", mime_type: "text/markdown", document_role: "EDITABLE", status: "completed", source_document_id: "pdf", pipeline_run_id: "convert:md", needs_reingest: false };

test("변환 전 PDF는 그래프에 없지만 편입 선택 트리에서는 변환 후 편입 대상으로 고를 수 있다", () => {
  assert.deepEqual(selectGraphDocuments([pdf]), []);
  assert.equal(isGraphIngestEligible(pdf, [pdf]), true);
  assert.equal(getGraphIngestBlockReason({ ...pdf, status: "processing" }, [pdf]), GRAPH_INGEST_BLOCK_REASONS.processing);
});

test("변환본이 있거나 변환 중인 PDF는 고를 수 없고, 실패한 변환본만 있으면 다시 고를 수 있다", () => {
  assert.equal(getGraphIngestBlockReason(pdf, [pdf, md]), GRAPH_INGEST_BLOCK_REASONS.pdfConverted);
  const converting = { ...md, status: "processing", pipeline_run_id: "convert:md" };
  assert.equal(getGraphIngestBlockReason(pdf, [pdf, converting]), GRAPH_INGEST_BLOCK_REASONS.pdfConverting);
  const failed = { ...md, status: "failed", pipeline_run_id: "convert:md" };
  assert.equal(getGraphIngestBlockReason(pdf, [pdf, failed]), null);
  // 파일명이 같아도 source_document_id로 연결되지 않은 Markdown은 변환본으로 보지 않는다.
  const unrelated = { ...md, id: "other", source_document_id: undefined, filename: "보고서.md" };
  assert.equal(getGraphIngestBlockReason(pdf, [pdf, unrelated]), null);
});

test("Markdown이 아닌 파일과 이미 최신으로 반영된 Markdown은 이유와 함께 막는다", () => {
  const txt = { id: "txt", filename: "memo.txt", mime_type: "text/plain", document_role: "EDITABLE", status: "completed" };
  assert.equal(getGraphIngestBlockReason(txt, [txt]), GRAPH_INGEST_BLOCK_REASONS.notMarkdown);
  const ingested = { ...md, pipeline_run_id: "ingest:md" };
  assert.equal(getGraphIngestBlockReason(ingested, [ingested]), GRAPH_INGEST_BLOCK_REASONS.upToDate);
});

test("변환된 Markdown은 이름이 바뀌어도 표시하고 PDF는 표시하지 않는다", () => {
  assert.deepEqual(selectGraphDocuments([pdf, md]), [md]);
  assert.equal(isGraphIngestEligible(md, [pdf, md]), true);
  const unrelated = { ...md, source_document_id: undefined, filename: "보고서.md" };
  assert.deepEqual(selectGraphDocuments([pdf, unrelated]), [unrelated]);
});

test("변환 중에는 Markdown만 표시하되 선택을 막는다", () => {
  const processing = { ...md, status: "processing" };
  assert.deepEqual(selectGraphDocuments([pdf, processing]), [processing]);
  assert.equal(getGraphIngestBlockReason(processing, [pdf, processing]), GRAPH_INGEST_BLOCK_REASONS.pdfConverting);
});

test("변환이 실패하면 PDF도 실패한 Markdown도 표시하지 않는다", () => {
  const failed = { ...md, status: "failed" };
  assert.deepEqual(selectGraphDocuments([pdf, failed]), []);
  assert.equal(getGraphIngestBlockReason(failed, [pdf, failed]), GRAPH_INGEST_BLOCK_REASONS.conversionFailed);
});

test("변환본을 삭제하면 PDF가 다시 나타나지 않는다", () => {
  assert.deepEqual(selectGraphDocuments([pdf]), []);
  const projects = [{ id: "p", title: "자료", items: [{ id: "pdf-item", documentId: "pdf", label: pdf.filename, type: "file" }] }];
  assert.deepEqual(filterGraphProjects(projects, [pdf])[0].items, []);
});

test("변환 성공 이후 편입만 실패한 Markdown은 그대로 표시하고 재시도할 수 있다", () => {
  const failed = { ...md, status: "failed", pipeline_run_id: "ingest:md" };
  assert.deepEqual(selectGraphDocuments([pdf, failed]), [failed]);
  assert.equal(isGraphIngestEligible(failed, [pdf, failed]), true);
});

test("중첩 폴더에서도 PDF만 숨기고 홈의 원본 트리는 변경하지 않는다", () => {
  const projects = [{ id: "p", title: "자료", items: [{ id: "folder", label: "폴더", children: [
    { id: "pdf-item", documentId: "pdf", label: pdf.filename, type: "file" },
    { id: "md-item", documentId: "md", label: md.filename, type: "file" }
  ] }] }];
  const filtered = filterGraphProjects(projects, [pdf, md]);
  assert.deepEqual(filtered[0].items[0].children.map((item) => item.documentId), ["md"]);
  assert.equal(projects[0].items[0].children.length, 2);
});
