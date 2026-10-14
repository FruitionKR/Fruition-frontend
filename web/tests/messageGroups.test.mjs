import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { groupMessagesByPair } = await import("../src/features/agent-chat/lib/messageGroups.ts");
const { buildSourceDocumentCards } = await import("../src/features/agent-chat/lib/relatedPageCards.ts");

test("groupMessagesByPair는 pair_id별로 묶고 pair 없는 메시지는 단독 그룹으로 둔다", () => {
  const groups = groupMessagesByPair([
    { id: "u1", role: "user", pair_id: "p1", content: "q", references: [] },
    { id: "a1", role: "assistant", pair_id: "p1", content: "a", references: [] },
    { id: "s", role: "assistant", content: "single", references: [] }
  ]);
  assert.deepEqual(groups.map((group) => [group.key, group.pairId, group.messages.map((m) => m.id)]), [
    ["p1", "p1", ["u1", "a1"]],
    ["s", null, ["s"]]
  ]);
});

const nodes = [
  { id: "raw:doc-1", kind: "raw", label: "회의록.md", documentId: "doc-1" },
  { id: "raw:doc-2", kind: "raw", label: "설계.pdf", documentId: "doc-2" },
  { id: "src-1", kind: "source", label: "회의록 요약", documentId: "doc-1" }
];

test("찾은 자료는 related_pages(위키 페이지)가 아니라 근거로 쓰인 원본 문서를 rank 순서로 보여 준다", () => {
  const cards = buildSourceDocumentCards({
    id: "a", role: "assistant", content: "",
    related_pages: [{ wiki_page_id: "concept-1", page_type: "concept", title: "Ingest", role: "primary", rank: 0 }],
    references: [
      { id: 2, reference_type: "evidence", rank: 2, source_document_id: "doc-2", source_block_ids: ["B2"], text: "둘째" },
      { id: 1, reference_type: "evidence", rank: 1, source_document_id: "doc-1", source_block_ids: ["B1"], text: "첫째" },
      { id: 3, reference_type: "evidence", rank: 3, source_document_id: "doc-1", source_block_ids: ["B3"] }
    ]
  }, nodes);
  assert.deepEqual(cards, [
    { key: "source-doc-1", documentId: "doc-1", title: "회의록.md", meta: "첫째", highlights: [{ block_id: "B1", rank: 1 }, { block_id: "B3", rank: 3 }] },
    { key: "source-doc-2", documentId: "doc-2", title: "설계.pdf", meta: "둘째", highlights: [{ block_id: "B2", rank: 2 }] }
  ]);
});

test("한 근거가 여러 문서를 가리키면(source_refs) 각 원본을 모두 넣고, 워크스페이스에 없는 문서는 뺀다", () => {
  const cards = buildSourceDocumentCards({
    id: "a", role: "assistant", content: "",
    references: [{
      id: 1, reference_type: "evidence", rank: 1, source_document_id: "doc-1", source_block_ids: ["B1"],
      source_refs: [
        { source_document_id: "doc-1", source_block_id: "B1" },
        { source_document_id: "doc-2", source_block_id: "B9" },
        { source_document_id: "doc-deleted", source_block_id: "B0" }
      ]
    }]
  }, nodes);
  assert.deepEqual(cards.map((card) => [card.documentId, card.highlights.map((item) => item.block_id)]), [
    ["doc-1", ["B1"]],
    ["doc-2", ["B9"]]
  ]);
});

test("그래프를 아직 받지 못했으면 문서 id가 제목으로 보이지 않게 찾은 자료를 미룬다", () => {
  const cards = buildSourceDocumentCards({
    id: "a", role: "assistant", content: "",
    references: [{ id: 1, reference_type: "evidence", rank: 1, source_document_id: "doc-1", source_block_ids: ["B1"] }]
  }, undefined);
  assert.deepEqual(cards, []);
});

test("근거가 없으면 찾은 자료도 없다", () => {
  assert.deepEqual(buildSourceDocumentCards({ id: "a", role: "assistant", content: "", references: [] }, nodes), []);
});
