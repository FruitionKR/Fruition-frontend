import assert from "node:assert/strict";
import test from "node:test";

const {
  STALLED_QUERY_AGE_MS,
  STALLED_TURN_AGE_MS,
  TURN_CANCEL_STATUSES,
  activeTurnStopOutcome,
  classifyTurnCheck,
  hasBlockingPendingMessages,
  isPendingAgentTurnMessage,
  isPendingQueryMessage,
  pendingAgentTurns,
  pendingQueryRuns,
  stalledQueryCancelNotice,
  stalledQueryQuestion,
  stalledTurnCancelOutcome,
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

test("pending인 채팅 질의 응답만 질의 확인 대상으로 보고 나이를 잰다", () => {
  assert.equal(isPendingQueryMessage(assistant("query_1")), true);
  assert.equal(isPendingQueryMessage(assistant("query_1", "completed")), false);
  assert.equal(isPendingQueryMessage(assistant("agent_1")), false);
  assert.equal(isPendingQueryMessage({ role: "user", status: "pending", run_id: "query_1" }), false);
  assert.deepEqual(
    pendingQueryRuns([assistant("query_old", "pending", minutesAgo(6)), assistant("agent_1"), assistant("query_new")], NOW),
    [{ turnId: "query_old", ageMs: 6 * 60_000 }, { turnId: "query_new", ageMs: 60_000 }]
  );
});

test("질의는 작업 turn보다 짧은 5분 기준으로 확인하고 판정한다", () => {
  assert.equal(STALLED_QUERY_AGE_MS, 5 * 60_000);
  assert.ok(STALLED_QUERY_AGE_MS < STALLED_TURN_AGE_MS);
  const pending = [{ turnId: "query_old", ageMs: STALLED_QUERY_AGE_MS }, { turnId: "query_new", ageMs: STALLED_QUERY_AGE_MS - 1 }];
  assert.deepEqual(
    turnsToCheck(pending, new Map(), { thresholdMs: STALLED_QUERY_AGE_MS }).map(({ turnId }) => turnId),
    ["query_old"]
  );
  // 같은 나이라도 작업 turn 기준(10분)이면 아직 확인하지 않는다.
  assert.deepEqual(turnsToCheck(pending, new Map()), []);
  assert.equal(classifyTurnCheck({ kind: "status", status: "running" }, STALLED_QUERY_AGE_MS, undefined, STALLED_QUERY_AGE_MS), "stalled");
  assert.equal(classifyTurnCheck({ kind: "status", status: "running" }, STALLED_QUERY_AGE_MS - 1, undefined, STALLED_QUERY_AGE_MS), "running");
  assert.equal(classifyTurnCheck({ kind: "missing" }, STALLED_QUERY_AGE_MS, undefined, STALLED_QUERY_AGE_MS), "stalled");
  // 끝났다는데 메시지가 계속 pending이면(두 번째 확인) 잠금을 풀 수 있게 한다.
  assert.equal(classifyTurnCheck({ kind: "status", status: "completed" }, STALLED_QUERY_AGE_MS, undefined, STALLED_QUERY_AGE_MS), "settled");
  assert.equal(classifyTurnCheck({ kind: "status", status: "completed" }, STALLED_QUERY_AGE_MS, "settled", STALLED_QUERY_AGE_MS), "stalled");
});

test("닫은 질의의 pending 메시지는 입력을 막지 않는다", () => {
  assert.equal(hasBlockingPendingMessages([assistant("query_1")], new Set(["query_1"])), false);
  assert.equal(hasBlockingPendingMessages([assistant("query_1"), assistant("query_2")], new Set(["query_1"])), true);
});

test("막힌 질의를 다시 보낼 질문은 같은 문답이나 같은 run의 사용자 메시지에서 찾는다", () => {
  const messages = [
    { role: "user", status: "completed", content: "이전 질문", pair_id: "pair_0", run_id: "query_0" },
    { role: "user", status: "completed", content: "  위키 편입은 어떻게 해?  ", pair_id: "pair_1" },
    { ...assistant("query_1"), content: "", pair_id: "pair_1" },
    { role: "user", status: "completed", content: "pair 없는 질문", run_id: "query_2" },
    { ...assistant("query_2"), content: "" },
    { ...assistant("query_3"), content: "" }
  ];
  assert.equal(stalledQueryQuestion(messages, "query_1"), "위키 편입은 어떻게 해?");
  assert.equal(stalledQueryQuestion(messages, "query_2"), "pair 없는 질문");
  assert.equal(stalledQueryQuestion(messages, "query_3"), null);
});

test("닫기 취소 요청을 서버에 전하지 못했거나 복구에 실패했을 때만 안내한다", () => {
  assert.equal(stalledQueryCancelNotice({ kind: "missing" }), null);
  for (const status of ["cancel_requested", "rolling_back", "cancelled", "completed"]) {
    assert.equal(stalledQueryCancelNotice({ kind: "status", status }), null);
  }
  assert.match(stalledQueryCancelNotice({ kind: "failed" }), /취소를 전하지 못했어요/);
  assert.match(stalledQueryCancelNotice({ kind: "status", status: "rollback_failed" }), /복구하지 못했어요/);
});

test("막힌 작업 닫기: 취소 계열이면 목록만 다시 받고, 복구 실패만 알린다", () => {
  assert.deepEqual([...TURN_CANCEL_STATUSES].sort(), ["cancel_requested", "cancelled", "rollback_failed", "rolling_back"]);
  for (const status of ["cancel_requested", "rolling_back", "cancelled"]) {
    assert.deepEqual(stalledTurnCancelOutcome({ kind: "status", status }), { notice: null, refresh: true, showResult: false }, status);
  }
  const rollbackFailed = stalledTurnCancelOutcome({ kind: "status", status: "rollback_failed" });
  assert.match(rollbackFailed.notice, /복구하지 못했어요/);
  assert.equal(rollbackFailed.refresh, true);
  assert.equal(rollbackFailed.showResult, false);
});

test("막힌 작업 닫기: 404는 조용히, 409(이미 끝남)는 결과를 다시 받고, 전하지 못하면 알린다", () => {
  assert.deepEqual(stalledTurnCancelOutcome({ kind: "missing" }), { notice: null, refresh: false, showResult: false });
  assert.deepEqual(stalledTurnCancelOutcome({ kind: "finished" }), { notice: null, refresh: true, showResult: true });
  // 200인데 취소 계열이 아닌 상태(경합으로 이미 끝남)도 끝난 결과로 본다.
  assert.deepEqual(stalledTurnCancelOutcome({ kind: "status", status: "completed" }), { notice: null, refresh: true, showResult: true });
  const failed = stalledTurnCancelOutcome({ kind: "failed" });
  assert.match(failed.notice, /취소를 전하지 못했어요/);
  assert.equal(failed.refresh, false);
  assert.equal(failed.showResult, false);
});

test("취소된(cancelled) 응답은 입력을 막지 않는다", () => {
  assert.equal(hasBlockingPendingMessages([assistant("agent_1", "cancelled")], new Set()), false);
  assert.equal(isPendingAgentTurnMessage(assistant("agent_1", "cancelled")), false);
  assert.deepEqual(pendingAgentTurns([assistant("agent_1", "cancelled", minutesAgo(20))], NOW), []);
});

test("진행 중인 작업을 Esc로 중지한 결과: 취소되면 목록을 다시 받고 잠금을 풀고, 전하지 못하거나 이미 끝났으면 다시 따라간다", () => {
  for (const status of ["cancel_requested", "rolling_back", "cancelled"]) {
    assert.deepEqual(activeTurnStopOutcome({ kind: "status", status }), { notice: null, refresh: true, release: true, resume: false });
  }
  const rollbackFailed = activeTurnStopOutcome({ kind: "status", status: "rollback_failed" });
  assert.equal(rollbackFailed.release, true);
  assert.match(rollbackFailed.notice, /복구하지 못했어요/);
  assert.deepEqual(activeTurnStopOutcome({ kind: "missing" }), { notice: null, refresh: false, release: true, resume: false });
  assert.deepEqual(activeTurnStopOutcome({ kind: "finished" }), { notice: null, refresh: false, release: false, resume: true });
  assert.deepEqual(activeTurnStopOutcome({ kind: "status", status: "completed" }), { notice: null, refresh: false, release: false, resume: true });
  const failed = activeTurnStopOutcome({ kind: "failed" });
  assert.equal(failed.release, false);
  assert.equal(failed.resume, true);
  assert.match(failed.notice, /다시 Esc/);
});
