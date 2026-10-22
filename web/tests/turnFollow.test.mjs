import assert from "node:assert/strict";
import test from "node:test";

const {
  AGENT_TURN_LOST_MESSAGE,
  AgentTurnLostError,
  followAgentTurn
} = await import("../src/features/agent-chat/lib/turnFollow.ts");

class Fatal extends Error {}

/** 조회 결과를 차례로 돌려주는 가짜 turn 조회. 함수 항목은 던진다. */
function scriptedFetch(script) {
  const calls = { count: 0 };
  const fetchTerminal = async () => {
    const step = script[Math.min(calls.count, script.length - 1)];
    calls.count += 1;
    if (step instanceof Error) throw step;
    return step;
  };
  return { fetchTerminal, calls };
}

function deps(overrides) {
  return {
    isFatal: (error) => error instanceof Fatal,
    signal: new AbortController().signal,
    cancelledMessage: "요청이 취소되었습니다.",
    sleep: async () => {},
    ...overrides
  };
}

test("SSE가 완료로 끝나면 바로 조회해 결과를 돌려주고 기다림 안내를 띄우지 않는다", async () => {
  const { fetchTerminal, calls } = scriptedFetch([{ ok: true }]);
  let slow = 0;
  const result = await followAgentTurn(deps({ readEvents: async () => "completed", fetchTerminal, onSlow: () => { slow += 1; } }));
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.count, 1);
  assert.equal(slow, 0);
});

test("SSE가 종료 이벤트 없이 끊기면 끝날 때까지 조회하고 기다림 안내를 한 번 띄운다", async () => {
  const { fetchTerminal, calls } = scriptedFetch([null, null, { ok: true }]);
  let slow = 0;
  const result = await followAgentTurn(deps({ readEvents: async () => "closed", fetchTerminal, onSlow: () => { slow += 1; } }));
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.count, 3);
  assert.equal(slow, 1);
});

test("SSE 연결 오류(signal timed out·네트워크 끊김)는 오류로 보이지 않고 조회로 넘어간다", async () => {
  const timeout = new DOMException("signal timed out", "TimeoutError");
  const { fetchTerminal } = scriptedFetch([null, { ok: true }]);
  const result = await followAgentTurn(deps({ readEvents: async () => { throw timeout; }, fetchTerminal }));
  assert.deepEqual(result, { ok: true });
  const network = new TypeError("network error");
  const second = scriptedFetch([{ ok: 2 }]);
  assert.deepEqual(await followAgentTurn(deps({ readEvents: async () => { throw network; }, fetchTerminal: second.fetchTerminal })), { ok: 2 });
});

test("서버가 알린 실패(query.failed)와 취소는 조회하지 않고 그대로 끝낸다", async () => {
  const { fetchTerminal, calls } = scriptedFetch([{ ok: true }]);
  await assert.rejects(
    followAgentTurn(deps({ readEvents: async () => { throw new Fatal("처리 실패"); }, fetchTerminal })),
    /처리 실패/
  );
  await assert.rejects(followAgentTurn(deps({ readEvents: async () => "cancelled", fetchTerminal })), /요청이 취소되었습니다/);
  assert.equal(calls.count, 0);
});

test("조회 중 일시 오류는 다시 조회하고, 실패·취소로 끝난 turn은 그 오류를 던진다", async () => {
  const transient = scriptedFetch([new TypeError("Failed to fetch"), null, { ok: true }]);
  assert.deepEqual(await followAgentTurn(deps({ readEvents: async () => "closed", fetchTerminal: transient.fetchTerminal })), { ok: true });
  const settled = scriptedFetch([null, new Fatal("AI 처리에 실패했습니다.")]);
  await assert.rejects(followAgentTurn(deps({ fetchTerminal: settled.fetchTerminal })), /AI 처리에 실패했습니다/);
});

test("조회가 계속 실패하거나 너무 오래 끝나지 않으면 한국어 안내로 멈춘다", async () => {
  const failing = scriptedFetch([new TypeError("Failed to fetch")]);
  const error = await followAgentTurn(deps({ fetchTerminal: failing.fetchTerminal, maxPollFailures: 3 })).catch((caught) => caught);
  assert.ok(error instanceof AgentTurnLostError);
  assert.equal(error.message, AGENT_TURN_LOST_MESSAGE);
  assert.equal(failing.calls.count, 3);

  let clock = 0;
  const pending = scriptedFetch([null]);
  const late = await followAgentTurn(deps({
    fetchTerminal: pending.fetchTerminal,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    pollIntervalMs: 1000,
    deadlineMs: 5000
  })).catch((caught) => caught);
  assert.ok(late instanceof AgentTurnLostError);
});

test("사용자가 취소하면 조회를 멈추고 취소 오류를 그대로 던진다", async () => {
  const controller = new AbortController();
  const { fetchTerminal, calls } = scriptedFetch([null]);
  const pending = followAgentTurn(deps({
    signal: controller.signal,
    fetchTerminal,
    sleep: async () => { controller.abort(new DOMException("aborted", "AbortError")); }
  }));
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(calls.count, 1);
});
