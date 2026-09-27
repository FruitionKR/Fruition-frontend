import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { buildNextActiveTurn } = await import("../src/features/agent-chat/lib/activeTurn.ts");

const user = (id, content) => ({ id, role: "user", content, references: [] });
const assistant = (id, extra = {}) => ({ id, role: "assistant", content: "답", references: [], ...extra });

test("buildNextActiveTurn은 새 assistant 메시지와 직전 사용자 질문을 찾는다", () => {
  const turn = buildNextActiveTurn(
    [user("u0", "예전"), assistant("a0"), user("u1", "새 질문"), assistant("a1")],
    new Set(["a0"]), [], "입력한 질문"
  );
  assert.equal(turn.assistantMessage?.id, "a1");
  assert.equal(turn.userMessageId, "u1");
  assert.equal(turn.question, "새 질문");
});

test("buildNextActiveTurn은 related_pages가 비면 질의 응답의 related_pages로 보강한다", () => {
  const turn = buildNextActiveTurn(
    [user("u1", "q"), assistant("a1")],
    new Set(),
    [{ id: "p1", page_type: "raw", title: "제목", slug: "s", relevance_score: 1, role: "r", depth: 0 }],
    "q"
  );
  assert.deepEqual(turn.assistantMessage?.related_pages, [
    { wiki_page_id: "p1", page_type: "raw", title: "제목", slug: "s", relevance_score: 1, role: "r", depth: 0, rank: 1 }
  ]);
});

test("buildNextActiveTurn은 새 assistant 메시지가 없으면 입력 질문만 남긴다", () => {
  const turn = buildNextActiveTurn([user("u0", "예전"), assistant("a0")], new Set(["a0"]), [], "입력");
  assert.equal(turn.assistantMessage, undefined);
  assert.equal(turn.userMessageId, undefined);
  assert.equal(turn.question, "입력");
});
