import assert from "node:assert/strict";
import test from "node:test";

const { createConcurrencyLimiter } = await import("../src/shared/lib/concurrencyLimit.ts");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("limit개까지만 동시에 시작하고, 끝나는 대로 기다린 작업을 순서대로 시작한다", async () => {
  const limit = createConcurrencyLimiter(2);
  const tasks = [deferred(), deferred(), deferred(), deferred()];
  const started = [];
  const results = tasks.map((task, index) => limit(() => { started.push(index); return task.promise; }));
  await flush();
  assert.deepEqual(started, [0, 1]);

  tasks[1].resolve("b");
  await flush();
  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(await results[1], "b");

  tasks[0].reject(new Error("a failed"));
  await assert.rejects(results[0], /a failed/);
  await flush();
  assert.deepEqual(started, [0, 1, 2, 3], "실패한 작업도 자리를 비운다");

  tasks[2].resolve("c");
  tasks[3].resolve("d");
  assert.deepEqual(await Promise.all(results.slice(2)), ["c", "d"]);
});

test("작업이 동기적으로 던져도 자리를 비우고 그 호출만 실패한다", async () => {
  const limit = createConcurrencyLimiter(1);
  const failed = limit(() => { throw new Error("sync"); });
  const next = limit(async () => "next");
  await assert.rejects(failed, /sync/);
  assert.equal(await next, "next");
});

test("onStart는 자리가 비어 있으면 호출 안에서 바로, 기다린 작업은 자리를 얻을 때 받은 순서대로 부른다", async () => {
  const limit = createConcurrencyLimiter(2);
  const tasks = [deferred(), deferred(), deferred(), deferred()];
  const startedEvents = [];
  const results = tasks.map((task, index) => limit(() => task.promise, () => startedEvents.push(index)));
  assert.deepEqual(startedEvents, [0, 1], "빈 자리 두 개는 같은 틱에 시작으로 알린다(\"대기 중\"이 보이지 않는다)");

  tasks[0].resolve("a");
  await flush();
  assert.deepEqual(startedEvents, [0, 1, 2], "자리가 나야 기다리던 작업이 시작으로 바뀐다");

  tasks[1].reject(new Error("b failed"));
  await assert.rejects(results[1], /b failed/);
  await flush();
  assert.deepEqual(startedEvents, [0, 1, 2, 3]);
  tasks[2].resolve("c");
  tasks[3].resolve("d");
  assert.deepEqual(await Promise.all([results[0], results[2], results[3]]), ["a", "c", "d"]);
});
