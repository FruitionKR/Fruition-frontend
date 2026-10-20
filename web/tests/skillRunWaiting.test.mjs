import assert from "node:assert/strict";
import test from "node:test";

const { skillRunWaitingState } = await import("../src/widgets/agent-panel/lib/skillRunWaiting.ts");

const idle = { stalledTurnCount: 0, hasBlockingPending: false, isQueryLoading: false, isAgentBusy: false, isWaitingForDocument: false };

test("보내기 전 스킬 실행 카드는 기다리는 이유를 적는다", () => {
  assert.deepEqual(skillRunWaitingState(idle), { label: "요청을 준비하고 있어요.", canReleaseBlocking: false });
  assert.equal(skillRunWaitingState({ ...idle, isWaitingForDocument: true }).label, "대상 문서를 여는 중이에요.");
  assert.equal(skillRunWaitingState({ ...idle, isQueryLoading: true, isWaitingForDocument: true }).label, "채팅 답변이 끝나면 바로 실행해요.");
  assert.equal(skillRunWaitingState({ ...idle, hasBlockingPending: true, isQueryLoading: true }).label, "앞선 작업이 끝나면 바로 실행해요.");
  assert.equal(skillRunWaitingState({ ...idle, isAgentBusy: true }).canReleaseBlocking, false);
});

test("응답을 받지 못한 앞선 작업에 막히면 이유와 함께 앞선 작업을 닫고 실행할 수 있게 한다", () => {
  const state = skillRunWaitingState({ ...idle, stalledTurnCount: 1, hasBlockingPending: true });
  assert.equal(state.canReleaseBlocking, true);
  assert.match(state.label, /응답을 받지 못해/);
});
