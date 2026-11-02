import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  }
});

const { agentTurnFailure, markdownCreateFailure, createAiTaskFailureReporter } = await import("../src/features/agent-chat/lib/aiTaskFailure.ts");
const { AgentTurnLostError } = await import("../src/features/agent-chat/lib/turnFollow.ts");
const { ApiError } = await import("../src/shared/lib/apiErrors.ts");

const networkError = () => new TypeError("Failed to fetch");

test("응답 없음으로 확정한 turn은 timeout 단계로 보낸다", () => {
  assert.deepEqual(agentTurnFailure(new AgentTurnLostError(), { turnId: "agent_1", clientTaskId: "client_1" }), {
    task_id: "agent_1", task_kind: "agent_turn", stage: "timeout", failure_reason: "timeout"
  });
});

test("서버에 닿지 않은 turn 요청은 result 단계, 클라이언트 ID로 보낸다", () => {
  assert.deepEqual(agentTurnFailure(networkError(), { turnId: null, clientTaskId: "client_1" }), {
    task_id: "client_1", task_kind: "agent_turn", stage: "result", failure_reason: "unknown"
  });
});

test("서버가 응답한 오류·서버가 아는 turn·취소는 보내지 않는다", () => {
  assert.equal(agentTurnFailure(new ApiError("서버 오류", 500), { turnId: null, clientTaskId: "client_1" }), null);
  assert.equal(agentTurnFailure(new ApiError("거절", 400), { turnId: "agent_1", clientTaskId: "client_1" }), null);
  assert.equal(agentTurnFailure(new Error("작업 실패"), { turnId: "agent_1", clientTaskId: "client_1" }), null);
  assert.equal(agentTurnFailure(networkError(), { turnId: "agent_1", clientTaskId: "client_1" }), null);
  assert.equal(agentTurnFailure(new DOMException("aborted", "AbortError"), { turnId: null, clientTaskId: "client_1" }), null);
});

test("AI 초안 문서 생성이 서버에 닿지 않으면 apply 단계·markdown_create로 보낸다", () => {
  assert.deepEqual(markdownCreateFailure(networkError(), "agent_1"), {
    task_id: "agent_1", task_kind: "agent_turn", stage: "apply", failure_reason: "unknown", action: "markdown_create"
  });
  assert.equal(markdownCreateFailure(new ApiError("저장 공간 초과", 413, "STORAGE_QUOTA_EXCEEDED"), "agent_1"), null);
  assert.equal(markdownCreateFailure(new ApiError("서버 오류", 500), "agent_1"), null);
});

test("같은 task_id는 한 번만 보낸다(다시 확인으로 같은 turn을 또 놓쳐도 1회)", () => {
  const sent = [];
  const report = createAiTaskFailureReporter((properties) => sent.push(properties));
  report(agentTurnFailure(new AgentTurnLostError(), { turnId: "agent_1", clientTaskId: "client_1" }));
  report(agentTurnFailure(new AgentTurnLostError(), { turnId: "agent_1", clientTaskId: "client_2" }));
  report(agentTurnFailure(new ApiError("서버 오류", 500), { turnId: "agent_2", clientTaskId: "client_3" }));
  report(agentTurnFailure(new AgentTurnLostError(), { turnId: "agent_2", clientTaskId: "client_3" }));
  assert.deepEqual(sent.map((item) => [item.task_id, item.stage]), [["agent_1", "timeout"], ["agent_2", "timeout"]]);
});
