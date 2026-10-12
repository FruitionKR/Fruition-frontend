import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_NOTICE_STORAGE_KEY,
  acknowledgeAiNotice,
  hasAcknowledgedAiNotice
} from "../src/shared/lib/aiNotice.ts";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    map
  };
}

test("처음에는 확인하지 않은 상태고, 확인하면 localStorage에 기록된다", () => {
  const storage = fakeStorage();
  assert.equal(hasAcknowledgedAiNotice(storage), false);
  assert.equal(acknowledgeAiNotice(storage), true);
  assert.equal(hasAcknowledgedAiNotice(storage), true);
  assert.ok(storage.map.has(AI_NOTICE_STORAGE_KEY));
});

test("저장소가 없거나(SSR) 읽기·쓰기가 던져도(사생활 모드) 예외 없이 미확인으로 본다", () => {
  assert.equal(hasAcknowledgedAiNotice(null), false);
  assert.equal(hasAcknowledgedAiNotice(undefined), false);
  assert.equal(acknowledgeAiNotice(null), false);

  const throwing = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); }
  };
  assert.equal(hasAcknowledgedAiNotice(throwing), false);
  assert.equal(acknowledgeAiNotice(throwing), false);
});

test("다른 값이 들어 있으면 확인한 것으로 보지 않는다", () => {
  const storage = fakeStorage();
  storage.setItem(AI_NOTICE_STORAGE_KEY, "true");
  assert.equal(hasAcknowledgedAiNotice(storage), false);
});
