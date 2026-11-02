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
