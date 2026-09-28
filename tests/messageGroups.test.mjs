import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { groupMessagesByPair } = await import("../src/features/agent-chat/lib/messageGroups.ts");
const { buildRelatedPageCards } = await import("../src/features/agent-chat/lib/relatedPageCards.ts");

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
  { id: "page-1", kind: "raw", label: "그래프 제목" },
  { id: "src-1", kind: "source", label: "원본 문서", documentId: "doc-1" }
];

test("buildRelatedPageCards는 related_pages를 우선하고 그래프에 없는 페이지는 거른다", () => {
  const cards = buildRelatedPageCards({
    id: "a", role: "assistant", content: "", references: [],
    related_pages: [
      { wiki_page_id: "page-1", page_type: "raw", title: "원제목", role: "", rank: 1 },
      { wiki_page_id: "unknown", page_type: "raw", title: "없음", role: "", rank: 2 }
    ]
  }, nodes);
  assert.deepEqual(cards, [{ key: "related-page-1", pageId: "page-1", pageType: "raw", title: "그래프 제목", meta: "관련 자료" }]);
});

test("buildRelatedPageCards는 related_pages가 없으면 references를 source 노드로 매핑하고 중복을 제거한다", () => {
  const cards = buildRelatedPageCards({
    id: "a", role: "assistant", content: "",
    references: [
      { id: 1, reference_type: "block", source_document_id: "doc-1", text: "근거" },
      { id: 2, reference_type: "block", source_document_id: "doc-1" },
      { id: 3, reference_type: "block", source_document_id: "doc-none" }
    ]
  }, nodes);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].key, "reference-1");
  assert.equal(cards[0].pageId, "src-1");
  assert.equal(cards[0].pageType, "source");
  assert.equal(cards[0].meta, "근거");
});
