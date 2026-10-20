import assert from "node:assert/strict";
import test from "node:test";

const {
  STALLED_TURN_AGE_MS,
  classifyTurnCheck,
  hasBlockingPendingMessages,
  isPendingAgentTurnMessage,
  pendingAgentTurns,
  turnsToCheck
} = await import("../src/features/agent-chat/lib/stalledTurns.ts");

const NOW = Date.parse("2026-10-20T12:00:00Z");
const minutesAgo = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

function assistant(run_id, status = "pending", created_at = minutesAgo(1)) {
  return { role: "assistant", status, run_id, created_at };
}

test("pending인 agent turn 응답만 확인 대상으로 보고 나이를 잰다", () => {
  assert.equal(isPendingAgentTurnMessage(assistant("agent_1")), true);
  assert.equal(isPendingAgentTurnMessage(assistant("agent_1", "completed")), false);
  assert.equal(isPendingAgentTurnMessage(assistant("query_1")), false);
  assert.equal(isPendingAgentTurnMessage({ role: "user", status: "pending", run_id: "agent_1" }), false);
  assert.deepEqual(
    pendingAgentTurns([assistant("agent_old", "pending", minutesAgo(12)), assistant("agent_new"), assistant("query_1")], NOW),
    [{ turnId: "agent_old", ageMs: 12 * 60_000 }, { turnId: "agent_new", ageMs: 60_000 }]
  );
  assert.deepEqual(pendingAgentTurns([assistant("agent_x", "pending", null)], NOW), [{ turnId: "agent_x", ageMs: 0 }]);
});

test("서버에 turn이 없거나(404), 10분 넘게 끝나지 않았으면 응답을 받지 못한 것으로 본다", () => {
  assert.equal(classifyTurnCheck({ kind: "missing" }, 0), "stalled");
  assert.equal(classifyTurnCheck({ kind: "status", status: "running" }, STALLED_TURN_AGE_MS), "stalled");
  assert.equal(classifyTurnCheck({ kind: "status", status: "queued" }, STALLED_TURN_AGE_MS - 1), "running");
  for (const status of ["completed", "failed", "cancelled", "rollback_failed"]) {
    assert.equal(classifyTurnCheck({ kind: "status", status }, STALLED_TURN_AGE_MS * 2), "settled");
  }
  // 끝났다고 했는데 다음 확인에도 메시지가 pending이면 더 바뀌지 않으므로 잠금을 풀 수 있게 한다.
  assert.equal(classifyTurnCheck({ kind: "status", status: "completed" }, STALLED_TURN_AGE_MS, "settled"), "stalled");
});

test("오래된 turn만 확인하고, 막힌 스킬 실행을 기다리면 새 turn도 한 번 확인한다", () => {
  const pending = [{ turnId: "old", ageMs: STALLED_TURN_AGE_MS }, { turnId: "young", ageMs: 5_000 }];
  assert.deepEqual(turnsToCheck(pending, new Map()).map(({ turnId }) => turnId), ["old"]);
  assert.deepEqual(turnsToCheck(pending, new Map(), { force: true }).map(({ turnId }) => turnId), ["old", "young"]);
  // 한 번 확인한 새 turn은 오래될 때까지 다시 묻지 않고, stalled로 정한 turn은 더 묻지 않는다.
  const verdicts = new Map([["young", "running"], ["old", "stalled"]]);
  assert.deepEqual(turnsToCheck(pending, verdicts, { force: true }), []);
  // 오래된 running turn은 확인 주기마다 다시 묻는다.
  assert.deepEqual(turnsToCheck(pending, new Map([["old", "running"]])).map(({ turnId }) => turnId), ["old"]);
  // 지금 따라가는 turn·닫은 turn은 묻지 않는다.
  assert.deepEqual(turnsToCheck(pending, new Map(), { force: true, ignoredTurnIds: new Set(["old", "young"]) }), []);
});

test("닫은 turn의 pending 메시지는 입력을 막지 않는다", () => {
  const messages = [assistant("agent_1"), { role: "user", status: "pending", run_id: "agent_2" }];
  assert.equal(hasBlockingPendingMessages(messages, new Set()), true);
  assert.equal(hasBlockingPendingMessages(messages, new Set(["agent_1"])), false);
  assert.equal(hasBlockingPendingMessages([assistant("query_1")], new Set(["agent_1"])), true);
  assert.equal(hasBlockingPendingMessages([assistant("agent_1", "completed")], new Set()), false);
});
