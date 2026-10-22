import assert from "node:assert/strict";
import test from "node:test";

const {
  TASK_OUTCOME_LIMIT,
  mergeTaskOutcomes,
  parseTaskOutcomes,
  readTaskOutcomes,
  recordTaskOutcome,
  taskOutcomeStorageKey,
  turnIdsWithOutcome,
  writeTaskOutcome
} = await import("../src/features/agent-chat/lib/taskOutcomes.ts");

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); }
  };
}

test("저장 키는 워크스페이스와 세션을 함께 담는다", () => {
  assert.equal(taskOutcomeStorageKey("ws-1", "s-1"), "fruition:task-outcomes:ws-1:s-1");
  assert.notEqual(taskOutcomeStorageKey("ws-1", "s-1"), taskOutcomeStorageKey("ws-2", "s-1"));
});

test("기록한 결과를 저장소에 쓰고 새로 고침 뒤 다시 읽는다", () => {
  const storage = memoryStorage();
  const key = taskOutcomeStorageKey("ws", "s");
  writeTaskOutcome(storage, key, "turn-a", "applied");
  writeTaskOutcome(storage, key, "turn-b", "rejected");
  writeTaskOutcome(storage, key, "turn-c", "cancelled");
  const restored = readTaskOutcomes(storage, key);
  assert.deepEqual([...turnIdsWithOutcome(restored, "applied")], ["turn-a"]);
  assert.deepEqual([...turnIdsWithOutcome(restored, "rejected")], ["turn-b"]);
  assert.deepEqual([...turnIdsWithOutcome(restored, "cancelled")], ["turn-c"]);
});

test("같은 turn을 다시 기록하면 최신 결과로 바꾸고 맨 뒤로 옮긴다", () => {
  let outcomes = recordTaskOutcome(new Map(), "a", "cancelled");
  outcomes = recordTaskOutcome(outcomes, "b", "applied");
  outcomes = recordTaskOutcome(outcomes, "a", "applied");
  assert.deepEqual([...outcomes], [["b", "applied"], ["a", "applied"]]);
});

test("한도를 넘으면 가장 오래된 turn부터 뺀다", () => {
  let outcomes = new Map();
  for (let index = 0; index < TASK_OUTCOME_LIMIT + 5; index += 1) outcomes = recordTaskOutcome(outcomes, `t${index}`, "applied");
  assert.equal(outcomes.size, TASK_OUTCOME_LIMIT);
  assert.equal(outcomes.has("t0"), false);
  assert.equal(outcomes.has(`t${TASK_OUTCOME_LIMIT + 4}`), true);
});

test("깨졌거나 모르는 형식의 저장값은 버리고 올바른 항목만 남긴다", () => {
  assert.equal(parseTaskOutcomes(null).size, 0);
  assert.equal(parseTaskOutcomes("{not json").size, 0);
  assert.equal(parseTaskOutcomes(JSON.stringify({ a: "applied" })).size, 0);
  const parsed = parseTaskOutcomes(JSON.stringify([["a", "applied"], ["b", "unknown"], [1, "rejected"], ["", "applied"], "x"]));
  assert.deepEqual([...parsed], [["a", "applied"]]);
});

test("저장소를 읽거나 쓰지 못해도 예외를 던지지 않는다", () => {
  const broken = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); }
  };
  assert.equal(readTaskOutcomes(broken, "k").size, 0);
  assert.doesNotThrow(() => writeTaskOutcome(broken, "k", "a", "applied"));
  assert.equal(readTaskOutcomes(null, "k").size, 0);
  assert.doesNotThrow(() => writeTaskOutcome(null, "k", "a", "applied"));
});

test("저장소에서 읽은 기록과 이 화면의 기록을 합치면 이 화면 값이 이긴다", () => {
  const stored = new Map([["a", "cancelled"], ["b", "rejected"]]);
  const current = new Map([["a", "applied"]]);
  const merged = mergeTaskOutcomes(stored, current);
  assert.equal(merged.get("a"), "applied");
  assert.equal(merged.get("b"), "rejected");
});
