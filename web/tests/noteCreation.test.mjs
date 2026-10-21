import assert from "node:assert/strict";
import test from "node:test";

const { createSingleFlight } = await import("../src/widgets/workspace/lib/noteCreation.ts");

test("새 노트를 만드는 동안 다시 눌러도(Space 8번) 노트는 하나만 만든다", async () => {
  const flight = createSingleFlight();
  let posts = 0;
  let finish;
  const create = () => {
    posts += 1;
    return new Promise((resolve) => { finish = resolve; });
  };
  const first = flight.run(create);
  const repeats = Array.from({ length: 8 }, () => flight.run(create));
  assert.equal(flight.isPending(), true);
  assert.deepEqual(await Promise.all(repeats), Array(8).fill(null), "진행 중에 들어온 요청은 무시한다");
  finish({ id: "doc_1" });
  assert.deepEqual(await first, { id: "doc_1" });
  assert.equal(posts, 1);
  assert.equal(flight.isPending(), false);
});

test("만들기가 실패해도 다음 요청은 다시 받는다", async () => {
  const flight = createSingleFlight();
  await assert.rejects(flight.run(() => Promise.reject(new Error("업로드 실패"))), /업로드 실패/);
  assert.equal(flight.isPending(), false);
  assert.deepEqual(await flight.run(async () => ({ id: "doc_2" })), { id: "doc_2" });
});
