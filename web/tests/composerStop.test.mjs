import assert from "node:assert/strict";
import test from "node:test";

const { composerStopHint, composerStoppingMessage, resolveComposerStopTarget } = await import("../src/widgets/agent-panel/lib/composerStop.ts");

const idle = {
  hasWaitingSkillRun: false,
  isQueryActive: false,
  isTurnFollowing: false,
  followingTurnId: null,
  pendingRuns: [],
  ignoredRunIds: new Set()
};
const turn = (runId, createdAt) => ({ runId, kind: "turn", createdAt });
const query = (runId, createdAt) => ({ runId, kind: "query", createdAt });

test("진행 중인 것이 없으면 Esc로 멈출 대상이 없다", () => {
  assert.equal(resolveComposerStopTarget(idle), null);
});

test("이 화면이 따라가는 질의·작업을 멈춘다. turn ID를 받기 전이면 ID 없이 대상으로 삼는다", () => {
  assert.deepEqual(resolveComposerStopTarget({ ...idle, isQueryActive: true }), { kind: "query" });
  assert.deepEqual(resolveComposerStopTarget({ ...idle, isTurnFollowing: true, followingTurnId: "agent_1" }), { kind: "following-turn", turnId: "agent_1" });
  assert.deepEqual(resolveComposerStopTarget({ ...idle, isTurnFollowing: true }), { kind: "following-turn", turnId: null });
});

test("여럿이 진행 중이면 가장 나중에 시작한 것 하나만 멈춘다", () => {
  const pendingRuns = [turn("agent_old", "2026-10-20T10:00:00Z"), query("query_new", "2026-10-20T11:00:00Z"), turn("agent_unknown", null)];
  // 보내기 전 스킬 실행은 앞선 것이 끝나기를 기다리는 중이라 가장 나중에 시작한 것이다.
  assert.deepEqual(resolveComposerStopTarget({ ...idle, hasWaitingSkillRun: true, isTurnFollowing: true, pendingRuns }), { kind: "skill-run" });
  // 이 화면이 따라가는 작업은 서버 기록의 다른 진행 중 요청보다 나중에 보냈다.
  assert.deepEqual(resolveComposerStopTarget({ ...idle, isTurnFollowing: true, followingTurnId: "agent_f", pendingRuns }), { kind: "following-turn", turnId: "agent_f" });
  // 서버 기록만 남았으면 시작 시각이 가장 늦은 것. 시각을 모르면 가장 오래된 것으로 본다.
  assert.deepEqual(resolveComposerStopTarget({ ...idle, pendingRuns }), { kind: "pending-query", runId: "query_new" });
  assert.deepEqual(resolveComposerStopTarget({ ...idle, pendingRuns: [turn("agent_unknown", null), turn("agent_old", "2026-10-20T10:00:00Z")] }), { kind: "pending-turn", turnId: "agent_old" });
});

test("이미 닫았거나 닫는 중인 run은 멈출 대상에서 뺀다", () => {
  const pendingRuns = [turn("agent_old", "2026-10-20T10:00:00Z"), query("query_new", "2026-10-20T11:00:00Z")];
  assert.deepEqual(resolveComposerStopTarget({ ...idle, pendingRuns, ignoredRunIds: new Set(["query_new"]) }), { kind: "pending-turn", turnId: "agent_old" });
  assert.equal(resolveComposerStopTarget({ ...idle, pendingRuns, ignoredRunIds: new Set(["query_new", "agent_old"]) }), null);
});

test("대상마다 Esc 안내와 멈추는 중 안내를 보여 준다", () => {
  assert.equal(composerStopHint({ kind: "query" }), "입력창에서 Esc를 누르면 질문을 취소합니다.");
  assert.equal(composerStopHint({ kind: "pending-query", runId: "q" }), "입력창에서 Esc를 누르면 질문을 취소합니다.");
  assert.equal(composerStopHint({ kind: "following-turn", turnId: null }), "입력창에서 Esc를 누르면 작업을 중지합니다.");
  assert.equal(composerStopHint({ kind: "pending-turn", turnId: "a" }), "입력창에서 Esc를 누르면 작업을 중지합니다.");
  assert.equal(composerStopHint({ kind: "skill-run" }), "입력창에서 Esc를 누르면 스킬 실행을 취소합니다.");
  assert.equal(composerStoppingMessage(null), null);
  assert.equal(composerStoppingMessage({ kind: "following-turn", turnId: "a" }), "작업을 중지하는 중…");
  assert.equal(composerStoppingMessage({ kind: "pending-turn", turnId: "a" }), "작업을 중지하는 중…");
  assert.equal(composerStoppingMessage({ kind: "pending-query", runId: "q" }), "질문을 취소하는 중…");
  // 채팅 질의는 질의 쪽이 "취소하고 변경을 복구하는 중"을 따로 안내한다.
  assert.equal(composerStoppingMessage({ kind: "query" }), null);
});
