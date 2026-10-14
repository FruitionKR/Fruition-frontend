import assert from "node:assert/strict";
import test from "node:test";
import { buildProgressSteps } from "../src/features/agent-chat/lib/progressSteps.ts";
const events = (...stages) => stages.map((stage, sequence) => ({stage, sequence, message: stage}));
test("실행 메시지를 네 단계로 묶고 새로고침 이후에도 같은 문구를 유지한다", () => {
  const steps = events("agent.routing", "query_started", "query_contextualized", "query_rewritten", "wiki_loaded", "retrieval_markdown_loaded", "retrieval_scored", "seeds_selected", "graph_traversed", "markdown_loaded", "context_built", "answer_generated", "query_evaluating", "query_evaluated", "agent.finalizing");
  const live = buildProgressSteps(steps, true);
  assert.deepEqual(live, [
    ["질문의 의도를 파악하고 있어요.", "done"], ["위키를 탐색하고 있어요.", "done"],
    ["답변을 생성하고 있어요.", "done"], ["답변을 검토하고 있어요.", "active"]
  ]);
  assert.deepEqual(buildProgressSteps(JSON.parse(JSON.stringify(steps)), false), live.map(([label]) => [label, "done"]));
});
test("재작성 뒤의 두 번째 검토와 실제 스킬 안내를 지우지 않는다", () => {
  const steps = events("agent.generating", "agent.evaluating", "agent.retrying", "agent.evaluating", "agent.finalizing");
  assert.equal(buildProgressSteps(steps, true).length, 4);
  assert.equal(buildProgressSteps(events("answer_generated", "agent.finalizing"), true).length, 1);
});
