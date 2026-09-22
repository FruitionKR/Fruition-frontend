import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });
const { selectGraphDocuments, filterGraphProjects, isGraphIngestEligible } = await import("../src/features/wiki-ingest/model/graphDocuments.ts");

const pdf = { id: "pdf", filename: "보고서.pdf", mime_type: "application/pdf", document_role: "ORIGINAL", status: "completed" };
const md = { id: "md", filename: "이름을 바꾼 변환본.md", mime_type: "text/markdown", document_role: "EDITABLE", status: "completed", source_document_id: "pdf", pipeline_run_id: "convert:md", needs_reingest: false };

test("변환본이 없으면 PDF를 표시하고 변환·편입 대상으로 선택할 수 있다", () => {
  assert.deepEqual(selectGraphDocuments([pdf]), [pdf]);
  assert.equal(isGraphIngestEligible(pdf), true);
  assert.equal(isGraphIngestEligible({ ...pdf, status: "processing" }), false);
});

test("이름이 바뀌어도 서버 원본 ID가 연결된 Markdown만 그래프에 표시한다", () => {
  assert.deepEqual(selectGraphDocuments([pdf, md]), [md]);
  assert.equal(isGraphIngestEligible(md), true);
  const unrelated = { ...md, source_document_id: undefined, filename: "보고서.md" };
  assert.deepEqual(selectGraphDocuments([pdf, unrelated]), [pdf, unrelated]);
});

test("변환 중에는 Markdown을 표시하되 선택을 막고 변환 실패 시 PDF로 재시도한다", () => {
  const processing = { ...md, status: "processing" };
  assert.deepEqual(selectGraphDocuments([pdf, processing]), [processing]);
  assert.equal(isGraphIngestEligible(processing), false);
  const failed = { ...md, status: "failed" };
  assert.deepEqual(selectGraphDocuments([pdf, failed]), [pdf]);
  assert.equal(isGraphIngestEligible(failed), false);
});

test("변환 성공 이후 편입만 실패한 Markdown은 그대로 표시하고 재시도할 수 있다", () => {
  const failed = { ...md, status: "failed", pipeline_run_id: "ingest:md" };
  assert.deepEqual(selectGraphDocuments([pdf, failed]), [failed]);
  assert.equal(isGraphIngestEligible(failed), true);
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
