import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });
const { buildDocumentPathSuffixes, withPathSuffix, ROOT_FOLDER_LABEL } = await import("../src/entities/graph/lib/documentLabels.ts");
const { buildGraphFromBackend } = await import("../src/entities/graph/lib/graph.ts");
const { buildRelatedPageCards } = await import("../src/features/agent-chat/lib/relatedPageCards.ts");

const md = (id, filename, extra = {}) => ({
  id, filename, mime_type: "text/markdown", document_role: "EDITABLE", status: "completed", ...extra
});
const docA = md("doc-a", "회의록.md");
const docB = md("doc-b", "회의록.md");
const docC = md("doc-c", "다른 문서.md");
const projects = [{ id: "root", title: "문서", items: [
  { id: "a", label: "회의록.md", type: "file", documentId: "doc-a" },
  { id: "f1", label: "2026", type: "folder", children: [
    { id: "f2", label: "1월", type: "folder", children: [
      { id: "b", label: "회의록.md", type: "file", documentId: "doc-b" }
    ] },
    { id: "c", label: "다른 문서.md", type: "file", documentId: "doc-c" }
  ] }
] }];

test("같은 이름의 Markdown 문서만 폴더 경로 접미사를 받고, 최상위 문서는 최상위로 표시한다", () => {
  const suffixes = buildDocumentPathSuffixes([docA, docB, docC], projects);
  assert.equal(suffixes.get("doc-a"), ROOT_FOLDER_LABEL);
  assert.equal(suffixes.get("doc-b"), "2026/1월");
  assert.equal(suffixes.has("doc-c"), false);
  assert.equal(withPathSuffix("회의록", suffixes.get("doc-a")), "회의록 · 최상위");
  assert.equal(withPathSuffix("다른 문서", suffixes.get("doc-c")), "다른 문서");
});

test("이름이 유일하면 접미사가 없고, 트리에서 못 찾은 중복 문서는 최상위로 본다", () => {
  assert.equal(buildDocumentPathSuffixes([docA, docC], projects).size, 0);
  const missing = md("doc-x", "회의록.md");
  const suffixes = buildDocumentPathSuffixes([docA, missing], projects);
  assert.equal(suffixes.get("doc-x"), ROOT_FOLDER_LABEL);
});

test("PDF 원본과 변환본은 이름이 같아도 겹침으로 세지 않는다", () => {
  const pdf = { id: "pdf", filename: "보고서.pdf", mime_type: "application/pdf", document_role: "ORIGINAL", status: "completed" };
  const converted = md("conv", "보고서.md", { source_document_id: "pdf" });
  // buildGraphFromBackend에 넘어오는 목록처럼 PDF를 빼지 않고 넘겨도 확장자가 달라 겹치지 않는다.
  assert.equal(buildDocumentPathSuffixes([pdf, converted], [{ items: [] }]).size, 0);
});

test("그래프의 원본·소스 노드 라벨과 관련 페이지 카드 제목이 같은 접미사를 쓴다", () => {
  const graph = { nodes: [
    { id: "src-a", title: "회의록", page_type: "source", source_document: { id: "doc-a" } },
    { id: "src-b", title: "회의록", page_type: "source", source_document: { id: "doc-b" } },
    { id: "src-c", title: "다른 문서", page_type: "source", source_document: { id: "doc-c" } }
  ], edges: [] };
  const documents = [docA, docB, docC];
  const { nodes } = buildGraphFromBackend(documents, graph, buildDocumentPathSuffixes(documents, projects));
  const label = (id) => nodes.find((node) => node.id === id)?.label;
  assert.equal(label("raw:doc-a"), "회의록.md · 최상위");
  assert.equal(label("raw:doc-b"), "회의록.md · 2026/1월");
  assert.equal(label("raw:doc-c"), "다른 문서.md");
  assert.equal(label("src-a"), "회의록 · 최상위");
  assert.equal(label("src-b"), "회의록 · 2026/1월");
  assert.equal(label("src-c"), "다른 문서");
  // 접미사를 넘기지 않으면 이전과 같은 라벨이다.
  assert.equal(buildGraphFromBackend(documents, graph).nodes.find((node) => node.id === "src-b")?.label, "회의록");

  const message = { related_pages: [{ wiki_page_id: "src-b", page_type: "source", title: "회의록", role: "근거" }], references: [] };
  assert.equal(buildRelatedPageCards(message, nodes)[0].title, "회의록 · 2026/1월");
});
