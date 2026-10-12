import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_NOTICE_STORAGE_KEY,
  acknowledgeAiNotice,
  hasAcknowledgedAiNotice
} from "../src/shared/lib/aiNotice.ts";

const USER = "user-1";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    map
  };
}

test("처음에는 확인하지 않은 상태고, 확인하면 사용자별 키로 localStorage에 기록된다", () => {
  const storage = fakeStorage();
  assert.equal(hasAcknowledgedAiNotice(storage, USER), false);
  assert.equal(acknowledgeAiNotice(storage, USER), true);
  assert.equal(hasAcknowledgedAiNotice(storage, USER), true);
  assert.ok(storage.map.has(`${AI_NOTICE_STORAGE_KEY}:${USER}`));
});

test("한 사용자의 확인은 같은 브라우저의 다른 사용자에게 적용되지 않는다", () => {
  const storage = fakeStorage();
  acknowledgeAiNotice(storage, USER);
  assert.equal(hasAcknowledgedAiNotice(storage, "user-2"), false);
});

test("저장소가 없거나(SSR) 읽기·쓰기가 던져도(사생활 모드) 예외 없이 미확인으로 본다", () => {
  assert.equal(hasAcknowledgedAiNotice(null, USER), false);
  assert.equal(hasAcknowledgedAiNotice(undefined, USER), false);
  assert.equal(acknowledgeAiNotice(null, USER), false);

  const throwing = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); }
  };
  assert.equal(hasAcknowledgedAiNotice(throwing, USER), false);
  assert.equal(acknowledgeAiNotice(throwing, USER), false);
});

test("다른 값이 들어 있으면 확인한 것으로 보지 않는다", () => {
  const storage = fakeStorage();
  storage.setItem(`${AI_NOTICE_STORAGE_KEY}:${USER}`, "true");
  assert.equal(hasAcknowledgedAiNotice(storage, USER), false);
});
