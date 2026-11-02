import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { advance, browserEnv, createResolver, render } from "./asyncHookShim.mjs";

registerHooks({ resolve: createResolver() });

const { useGraphRefresh, GRAPH_UP_TO_DATE_FEEDBACK_MS, GRAPH_REFRESH_ERROR_NOTICE } =
  await import("../src/widgets/graph/model/useGraphRefresh.ts");
const { subscribeNotices } = await import("../src/features/document-notifications/model/noticeBus.ts");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(t, refresh) {
  browserEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notices = [];
  t.after(subscribeNotices((notice) => notices.push(notice)));
  const view = render(() => useGraphRefresh(refresh));
  return { view, notices };
}

test("새로고침 중에는 loading이고 다시 눌러도 요청을 또 보내지 않는다", async (t) => {
  const pending = deferred();
  let calls = 0;
  const { view } = setup(t, () => { calls += 1; return pending.promise; });

  assert.equal(view.rerender().status, "idle");
  void view.rerender().refresh();
  assert.equal(view.rerender().status, "loading");
  void view.rerender().refresh();
  assert.equal(calls, 1, "진행 중 반복 클릭은 무시한다");

  pending.resolve({ changed: true });
  await advance(t, 0);
  assert.equal(view.rerender().status, "idle", "바뀐 내용이 있으면 노드 등장 연출이 피드백이라 문구 없이 끝낸다");
});

test("바뀐 것이 없으면 잠깐 upToDate를 보였다가 idle로 돌아간다", async (t) => {
  const { view } = setup(t, async () => ({ changed: false }));
  void view.rerender().refresh();
  await advance(t, 0);
  assert.equal(view.rerender().status, "upToDate");
  await advance(t, GRAPH_UP_TO_DATE_FEEDBACK_MS - 1);
  assert.equal(view.rerender().status, "upToDate");
  await advance(t, 1);
  assert.equal(view.rerender().status, "idle");
});

test("실패하면 오류 알림을 띄우고 idle로 돌아가 다시 시도할 수 있다", async (t) => {
  let calls = 0;
  const { view, notices } = setup(t, async () => {
    calls += 1;
    throw new Error("network");
  });
  void view.rerender().refresh();
  await advance(t, 0);
  assert.equal(view.rerender().status, "idle");
  assert.deepEqual(notices, [{ kind: "failed", ...GRAPH_REFRESH_ERROR_NOTICE }]);
  assert.equal(GRAPH_REFRESH_ERROR_NOTICE.message, "그래프를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");

  void view.rerender().refresh();
  await advance(t, 0);
  assert.equal(calls, 2);
});
