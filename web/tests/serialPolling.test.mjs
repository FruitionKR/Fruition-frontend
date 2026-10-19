import assert from "node:assert/strict";
import test from "node:test";

const { startSerialPolling } = await import("../src/shared/lib/serialPolling.ts");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("조회가 주기보다 느려도 앞 조회가 끝난 뒤에야 다음 조회를 보내고, 끝났다고 답하면 더 묻지 않는다", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  let finished = 0;
  const stop = startSerialPolling(async () => {
    calls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(30);
    inFlight -= 1;
    if (calls < 3) return false;
    finished += 1;
    return true;
  }, 5);

  await sleep(200);
  stop();
  assert.equal(maxInFlight, 1);
  assert.equal(calls, 3);
  assert.equal(finished, 1);
});

test("멈추면 예약한 조회를 보내지 않고, 진행 중인 조회가 끝나도 다음을 예약하지 않는다", async () => {
  let calls = 0;
  const stop = startSerialPolling(async () => {
    calls += 1;
    await sleep(20);
    return false;
  }, 5);
  await sleep(10);
  stop();
  await sleep(60);
  assert.equal(calls, 1);

  let never = 0;
  startSerialPolling(async () => { never += 1; return true; }, 5)();
  await sleep(20);
  assert.equal(never, 0);
});

test("조회가 던지면 다음 주기에 다시 묻는다", async () => {
  let calls = 0;
  const stop = startSerialPolling(async () => {
    calls += 1;
    if (calls === 1) throw new Error("일시 실패");
    return true;
  }, 5);
  await sleep(40);
  stop();
  assert.equal(calls, 2);
});
