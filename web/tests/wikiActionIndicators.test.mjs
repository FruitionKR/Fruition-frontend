import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });
const { selectPendingIngestDocuments, getIngestIndicator, getLintIndicator } = await import("../src/widgets/document-sidebar/model/wikiActionIndicators.ts");

const md = (id, extra = {}) => ({ id, filename: `${id}.md`, mime_type: "text/markdown", document_role: "EDITABLE", status: "completed", needs_reingest: false, ...extra });

test("신규(uploaded)와 편입 후 수정된 Markdown만 편입할 문서로 센다", () => {
  const documents = [
    md("new", { status: "uploaded" }),
    md("changed", { needs_reingest: true }),
    md("done"),
    md("running", { status: "processing" }),
    md("failed", { status: "failed" })
  ];
  assert.deepEqual(selectPendingIngestDocuments(documents).map((document) => document.id), ["new", "changed"]);
});

test("PDF 원본·TXT·변환 중 문서는 세지 않고, 변환을 마친 Markdown은 신규로 센다", () => {
  const pdf = { id: "pdf", filename: "a.pdf", mime_type: "application/pdf", document_role: "ORIGINAL", status: "uploaded" };
  const txt = { id: "txt", filename: "a.txt", mime_type: "text/plain", document_role: "EDITABLE", status: "uploaded" };
  const converting = md("converting", { status: "processing", pipeline_run_id: "convert:1", source_document_id: "pdf" });
  const converted = md("converted", { pipeline_run_id: "convert:2", source_document_id: "pdf2" });
  assert.deepEqual(selectPendingIngestDocuments([pdf, txt, converting, converted]).map((document) => document.id), ["converted"]);
});

test("편입 버튼 불은 편입할 문서가 있고 바로 누를 수 있을 때만 켜지고 개수를 말풍선에 보여 준다", () => {
  assert.deepEqual(getIngestIndicator({ pendingCount: 3, isSelecting: false, isDisabled: false }), {
    isLit: true,
    tooltip: "편입할 위키가 있어요 (3개 문서)",
    label: "위키 편입, 편입할 문서 3개"
  });
  assert.equal(getIngestIndicator({ pendingCount: 0, isSelecting: false, isDisabled: false }).isLit, false);
  assert.equal(getIngestIndicator({ pendingCount: 3, isSelecting: true, isDisabled: false }).isLit, false);
  assert.equal(getIngestIndicator({ pendingCount: 3, isSelecting: false, isDisabled: true }).tooltip, null);
});

test("최신화 버튼 불은 최신화를 바로 실행할 수 있고 문서 선택 중이 아닐 때만 켜진다", () => {
  assert.deepEqual(getLintIndicator({ isLintEnabled: true, isSelecting: false }), {
    isLit: true,
    tooltip: "위키 최신화가 가능해요",
    label: "위키 최신화, 최신화 가능"
  });
  assert.equal(getLintIndicator({ isLintEnabled: false, isSelecting: false }).isLit, false);
  assert.equal(getLintIndicator({ isLintEnabled: true, isSelecting: true }).isLit, false);
});
