import assert from "node:assert/strict";
import test from "node:test";
import { mergeQueryAnswer } from "../src/features/agent-chat/lib/queryAnswerMessages.ts";
import { classifyChatExportPairs } from "../src/features/agent-chat/lib/chatPairSelection.ts";

const PREVIOUS = [
  { id: "u1", pair_id: "pair-1", role: "user", content: "이전 질문", status: "completed" },
  { id: "a1", pair_id: "pair-1", role: "assistant", content: "이전 답변", status: "completed", action: "chat_answer" }
];
const LATEST = [
  { id: "u2", pair_id: "pair-2", role: "user", content: "최신 질문", status: "completed" },
  { id: "a2", pair_id: "pair-2", role: "assistant", content: "최신 답변", status: "completed", action: "chat_answer" }
];
const RELATED = [
  { id: "page-1", page_type: "source", title: "문서", slug: "doc", relevance_score: 0.9, role: "seed", depth: 0 }
];

test("최신 답변을 목록 안에 둔 채 related page로 보강한다", () => {
  const result = mergeQueryAnswer([...PREVIOUS, ...LATEST], new Set(["a1"]), RELATED);

  assert.equal(result.answerMessageId, "a2");
  assert.deepEqual(result.messages.map((message) => message.id), ["u1", "a1", "u2", "a2"]);
  assert.equal(result.messages[3].related_pages[0].wiki_page_id, "page-1");
  assert.equal(result.messages[3].related_pages[0].rank, 1);
});

test("질의가 끝난 최신 문답도 편입 범위 후보가 된다", () => {
  const result = mergeQueryAnswer([...PREVIOUS, ...LATEST], new Set(["a1"]), RELATED);

  assert.deepEqual(classifyChatExportPairs(result.messages).selectablePairIds, ["pair-1", "pair-2"]);
});

test("저장된 related page가 있으면 질의 응답 값으로 덮어쓰지 않는다", () => {
  const stored = [{ wiki_page_id: "stored", page_type: "source", title: "저장", slug: "s", rank: 1 }];
  const messages = [...PREVIOUS, LATEST[0], { ...LATEST[1], related_pages: stored }];

  const result = mergeQueryAnswer(messages, new Set(["a1"]), RELATED);

  assert.equal(result.messages, messages);
  assert.equal(result.answerMessageId, "a2");
});

test("새 답변이 없으면 목록을 그대로 두고 애니메이션 대상도 없다", () => {
  const result = mergeQueryAnswer(PREVIOUS, new Set(["a1"]), RELATED);

  assert.equal(result.messages, PREVIOUS);
  assert.equal(result.answerMessageId, null);
});
