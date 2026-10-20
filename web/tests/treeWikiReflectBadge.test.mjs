import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });
const { buildTreeWikiReflectBadges, getTreeWikiReflectBadge } = await import("../src/widgets/document-sidebar/model/treeWikiReflectBadge.ts");

const md = (id, extra = {}) => ({ id, filename: `${id}.md`, mime_type: "text/markdown", document_role: "EDITABLE", status: "completed", needs_reingest: false, ...extra });
const badgeOf = (document, documents = [document]) => getTreeWikiReflectBadge(document, documents);

test("한 번도 편입하지 않은 문서는 신규 배지를 붙인다", () => {
  assert.deepEqual(badgeOf(md("new", { status: "uploaded" })), {
    label: "신규",
    tone: "new",
    description: "위키에 아직 편입하지 않은 문서"
  });
  // 직접 만든 새 노트: run 없이 needs_reingest=true
  assert.equal(badgeOf(md("note", { needs_reingest: true }))?.label, "신규");
});

test("편입 후 편집된 문서는 수정됨, 편입에 실패한 문서는 재시도 배지를 붙인다", () => {
  assert.deepEqual(badgeOf(md("changed", { needs_reingest: true, pipeline_run_id: "run-1" })), {
    label: "수정됨",
    tone: "changed",
    description: "위키 편입 후 수정된 문서"
  });
  assert.deepEqual(badgeOf(md("failed", { status: "failed", pipeline_run_id: "run-2" })), {
    label: "재시도",
    tone: "retry",
    description: "위키 편입에 실패한 문서"
  });
});

test("최신 반영 문서와 편입 진행 중 문서는 배지를 붙이지 않는다", () => {
  assert.equal(badgeOf(md("done", { pipeline_run_id: "run-1" })), null);
  assert.equal(badgeOf(md("running", { status: "processing", needs_reingest: true })), null);
  assert.equal(badgeOf(md("stalled", { status: "uploaded", processing_state: "stalled" })), null);
});

test("PDF 원본·TXT는 편입할 수 있는 상태여도 배지를 붙이지 않는다", () => {
  const pdf = { id: "pdf", filename: "a.pdf", mime_type: "application/pdf", document_role: "ORIGINAL", status: "uploaded" };
  const txt = { id: "txt", filename: "a.txt", mime_type: "text/plain", document_role: "EDITABLE", status: "uploaded" };
  assert.equal(badgeOf(pdf), null);
  assert.equal(badgeOf(txt), null);
});

test("채팅 편입 문서도 편입 전이면 신규 배지를 붙인다", () => {
  assert.equal(badgeOf(md("chat", { status: "uploaded", ai_origin: "chat_export" }))?.label, "신규");
});

test("PDF 변환 중이거나 변환에 실패한 노트는 배지를 붙이지 않고, 변환을 마친 노트는 신규로 본다", () => {
  assert.equal(badgeOf(md("converting", { status: "processing", pipeline_run_id: "convert:1" })), null);
  assert.equal(badgeOf(md("convert-failed", { status: "failed", pipeline_run_id: "convert:2" })), null);
  assert.equal(badgeOf(md("converted", { pipeline_run_id: "convert:3" }))?.label, "신규");
});

test("문서 id별 배지 맵에는 배지가 있는 문서만 담는다", () => {
  const badges = buildTreeWikiReflectBadges([
    md("new", { status: "uploaded" }),
    md("done", { pipeline_run_id: "run-1" }),
    md("failed", { status: "failed", pipeline_run_id: "run-2" })
  ]);
  assert.deepEqual([...badges.keys()], ["new", "failed"]);
  assert.equal(badges.get("failed")?.tone, "retry");
});
