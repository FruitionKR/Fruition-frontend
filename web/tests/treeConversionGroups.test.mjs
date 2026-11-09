import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { useTranslations as koT } from "./fakeNextIntl.mjs";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });
const {
  buildTreeConversionGroups,
  conversionCollapseStorageKey,
  groupedChildBadge,
  groupedSourceBadge,
  ungroupedTreeRows,
  visibleTreeRowIds
} = await import("../src/widgets/document-sidebar/model/treeConversionGroups.ts");
const { getTreeConversionBadge } = await import("../src/widgets/document-sidebar/model/treeConversionBadge.ts");

const pdfDoc = (id, extra = {}) => ({ id, filename: `${id}.pdf`, mime_type: "application/pdf", document_role: "ORIGINAL", status: "completed", ...extra });
const mdDoc = (id, source, extra = {}) => ({ id, filename: `${id}.md`, mime_type: "text/markdown", document_role: "EDITABLE", status: "completed", source_document_id: source, pipeline_run_id: "convert:1", ...extra });
const row = (document) => ({ id: `document-file-${document.id}`, label: document.filename, type: "file", documentId: document.id });
const folder = (id, children) => ({ id, label: id, type: "folder", children });
const ids = (children) => children?.map((child) => child.item.id);

test("같은 폴더의 변환본을 원본 PDF 아래로 묶고 원래 자리에서는 뺀다", () => {
  const pdf = pdfDoc("a");
  const md = mdDoc("a-md", "a");
  const memo = mdDoc("memo", undefined);
  const items = [row(pdf), row(memo), row(md)];
  const groups = buildTreeConversionGroups(items, [pdf, md, memo]);
  assert.deepEqual(ids(groups.childrenBySourceId.get("document-file-a")), ["document-file-a-md"]);
  assert.deepEqual(ungroupedTreeRows(items, groups).map((item) => item.id), ["document-file-a", "document-file-memo"]);
});

test("하위 폴더 안에서도 같은 형제 목록끼리 묶는다", () => {
  const pdf = pdfDoc("a");
  const md = mdDoc("a-md", "a");
  const groups = buildTreeConversionGroups([folder("f", [row(md), row(pdf)])], [pdf, md]);
  assert.deepEqual(ids(groups.childrenBySourceId.get("document-file-a")), ["document-file-a-md"]);
  assert.ok(groups.groupedIds.has("document-file-a-md"));
});

test("원본이 다른 폴더에 있거나 목록에 없으면 변환본을 제자리에 둔다", () => {
  const pdf = pdfDoc("a");
  const md = mdDoc("a-md", "a");
  const otherFolder = buildTreeConversionGroups([row(pdf), folder("f", [row(md)])], [pdf, md]);
  assert.equal(otherFolder.groupedIds.size, 0);
  // 원본이 삭제됐거나 권한 때문에 문서 목록에 없는 경우
  const missing = buildTreeConversionGroups([row(md)], [md]);
  assert.equal(missing.groupedIds.size, 0);
  // 트리에는 있지만 문서 목록에 원본이 없는 경우도 PDF인지 알 수 없어 묶지 않는다.
  const unknownSource = buildTreeConversionGroups([row(pdf), row(md)], [md]);
  assert.equal(unknownSource.groupedIds.size, 0);
});

test("변환 중인 변환본은 변환 중 자식 행으로 묶는다", () => {
  const pdf = pdfDoc("a");
  const converting = mdDoc("a-md", "a", { status: "processing" });
  const groups = buildTreeConversionGroups([row(pdf), row(converting)], [pdf, converting]);
  assert.deepEqual(groups.childrenBySourceId.get("document-file-a")?.map((child) => child.isConverting), [true]);
});

test("변환본이 여러 개면 모두 트리 순서대로 원본 아래에 묶는다", () => {
  const pdf = pdfDoc("a");
  const first = mdDoc("a-1", "a");
  const rerun = mdDoc("a-2", "a", { status: "processing", pipeline_run_id: "convert:2" });
  const groups = buildTreeConversionGroups([row(first), row(pdf), row(rerun)], [pdf, first, rerun]);
  assert.deepEqual(ids(groups.childrenBySourceId.get("document-file-a")), ["document-file-a-1", "document-file-a-2"]);
});

test("변환에 실패한 변환본은 없는 것으로 보고 제자리에 일반 행으로 둔다", () => {
  const pdf = pdfDoc("a");
  const failed = mdDoc("a-md", "a", { status: "failed" });
  const groups = buildTreeConversionGroups([row(pdf), row(failed)], [pdf, failed]);
  assert.equal(groups.groupedIds.size, 0);
  assert.equal(groups.childrenBySourceId.has("document-file-a"), false);
  // 위키 편입 실패처럼 변환이 아닌 실패는 이미 변환을 마친 변환본이라 묶는다.
  const ingestFailed = mdDoc("a-md", "a", { status: "failed", pipeline_run_id: "ingest:1" });
  assert.equal(buildTreeConversionGroups([row(pdf), row(ingestFailed)], [pdf, ingestFailed]).groupedIds.size, 1);
});

test("업로드 자리표시 행과 PDF가 아닌 원본은 묶지 않는다", () => {
  const txt = { id: "t", filename: "t.txt", mime_type: "text/plain", document_role: "ORIGINAL", status: "completed" };
  const md = mdDoc("t-md", "t");
  assert.equal(buildTreeConversionGroups([row(txt), row(md)], [txt, md]).groupedIds.size, 0);
  const upload = { id: "upload-1", label: "a.pdf", type: "file", status: "uploading" };
  assert.equal(buildTreeConversionGroups([upload], []).groupedIds.size, 0);
});

test("보이는 행 순서는 변환본을 원본 PDF 바로 뒤에 두고 접으면 뺀다", () => {
  const pdf = pdfDoc("a");
  const md = mdDoc("a-md", "a");
  const memo = mdDoc("memo", undefined);
  const items = [folder("f", [row(pdf), row(memo), row(md)]), row(pdfDoc("z"))];
  const groups = buildTreeConversionGroups(items, [pdf, md, memo]);
  assert.deepEqual(visibleTreeRowIds(items, new Set(["f"]), groups, new Set()), [
    "f", "document-file-a", "document-file-a-md", "document-file-memo", "document-file-z"
  ]);
  assert.deepEqual(visibleTreeRowIds(items, new Set(["f"]), groups, new Set(["document-file-a"])), [
    "f", "document-file-memo", "document-file-z"
  ]);
  assert.deepEqual(visibleTreeRowIds(items, new Set(), groups, new Set()), ["f", "document-file-z"]);
});

test("원본 PDF 배지는 펼치면 원본 PDF, 접으면 변환본 개수를 보인다", () => {
  const pdf = pdfDoc("a");
  const md = mdDoc("a-md", "a");
  const badge = getTreeConversionBadge(pdf, [pdf, md]);
  assert.equal(groupedSourceBadge(badge, 1, false), badge);
  const collapsed = groupedSourceBadge(badge, 2, true);
  assert.equal(collapsed.label, "converted");
  assert.equal(collapsed.collapsedCount, 2);
  assert.equal(koT("documents.tree.conversion")("convertedCount", { count: collapsed.collapsedCount }), "변환본 2");
  assert.equal(collapsed.relatedDocumentId, "a-md");
  // 변환 중이라 기존 배지가 없으면 링크 없는 원본 PDF 배지를 만든다.
  const converting = groupedSourceBadge(null, 1, false);
  assert.equal(converting.label, "source");
  assert.equal(converting.description.kind, "sourceConverting");
  assert.equal(converting.relatedDocumentId, null);
});

test("변환 중인 자식 행은 링크 없는 변환 중 배지, 끝난 변환본은 기존 배지를 그대로 쓴다", () => {
  const pdf = pdfDoc("a");
  const md = mdDoc("a-md", "a");
  const badge = getTreeConversionBadge(md, [pdf, md]);
  assert.equal(groupedChildBadge(badge, false), badge);
  const converting = groupedChildBadge(badge, true);
  assert.equal(converting.label, "converting");
  assert.equal(koT("documents.tree.conversion")(`label.${converting.label}`), "변환 중");
  assert.equal(converting.relatedDocumentId, null);
});

test("접힘 상태는 워크스페이스별 fruition. 접두어 키에 둔다(로그아웃 때 함께 지운다)", () => {
  assert.equal(conversionCollapseStorageKey("ws-1"), "fruition.tree-conversion-collapsed.ws-1");
});

test("휴대폰 폭에서도 변환본 행이 넘치지 않게 연결선은 행 안에 절대 위치로 그리고 배지는 줄바꿈하지 않는다", () => {
  const css = readFileSync(new URL("../src/widgets/document-sidebar/ui/DocumentSidebar.module.css", import.meta.url), "utf8");
  assert.match(css, /\.tree-row\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.tree-conversion-branch\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;/s);
  assert.match(css, /\.tree-type-badge\.is-conversion\s*\{[^}]*white-space:\s*nowrap;/s);
  // 색은 base.css 토큰만 쓴다.
  const block = css.slice(css.indexOf(".tree-row.is-converting"), css.indexOf(".tree-folder-slot.is-toggle:hover"));
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b|rgb\(/i);
});
