import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { advance, browserEnv, createResolver, fakeUserPreferences, render } from "./asyncHookShim.mjs";

registerHooks({
  resolve: createResolver({
    "@/entities/user": new URL("./asyncHookShim.mjs", import.meta.url).href,
    "@/entities/document": new URL("./fakeDocumentEntity.mjs", import.meta.url).href
  })
});

const { usePendingWorkNotifications } = await import(
  "../src/features/document-notifications/model/usePendingWorkNotifications.ts"
);
const { subscribeNotices } = await import("../src/features/document-notifications/model/noticeBus.ts");
const { reflectCalls, setReflectFailure } = await import("./fakeDocumentEntity.mjs");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");

const PROMPT_DEBOUNCE_MS = 3_000;
const STALL_MS = 60_000;
const STALL_CHECK_MS = 30_000;
const STATUS_PATH = "/api/workspaces/ws_test/wiki/maintenance/status";

function doc(id, status = "uploaded", overrides = {}) {
  return {
    id,
    filename: `${id}.md`,
    mime_type: "text/markdown",
    byte_size: 1,
    status,
    source_uri: `s3://${id}`,
    uploaded_at: "2026-10-12T00:00:00Z",
    document_role: "EDITABLE",
    ...overrides
  };
}

/** 알림 카드를 모두 모으고, 유지보수 상태 API를 흉내 낸다. */
function notificationEnv(t, { needsLint = false } = {}) {
  const env = browserEnv(t);
  saveAccessToken("test-access");
  fakeUserPreferences.preferences = { notifications: { query: true, suggest: true } };
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000_000 });
  const notices = [];
  const unsubscribe = subscribeNotices((notice) => notices.push(notice));
  t.after(unsubscribe);
  const statusRequests = [];
  t.mock.method(globalThis, "fetch", async (path) => {
    statusRequests.push(path);
    assert.equal(path, STATUS_PATH, `예상 밖 요청 ${path}`);
    return Response.json({ needs_lint: needsLint });
  });
  reflectCalls.length = 0;
  setReflectFailure(null);
  return { ...env, notices, statusRequests, titles: () => notices.map((notice) => notice.title) };
}

function renderNotifications(documents) {
  const props = { documents };
  const view = render(() => usePendingWorkNotifications(props.documents));
  return {
    setDocuments(next) {
      props.documents = next;
      view.rerender();
    },
    unmount: view.unmount
  };
}

test("세션에 들어왔을 때 편입 대기 문서가 있으면 즉시 제안하고 새로고침 뒤에는 같은 카드를 반복하지 않는다", async (t) => {
  const { notices, titles } = notificationEnv(t);
  const view = renderNotifications([doc("d1"), doc("d2", "completed")]);

  assert.deepEqual(titles(), ["위키 편입 대기 중인 문서가 있습니다"]);
  assert.equal(notices[0].message, '"d1.md" 문서의 위키 편입을 시작해 보세요.');

  notices[0].action.onAction();
  await advance(t, 0);
  assert.deepEqual(reflectCalls, [["d1", "EDITABLE"]]);

  // 새로고침(재마운트): 제안 기록은 localStorage에 남아 다시 띄우지 않는다.
  view.unmount();
  renderNotifications([doc("d1")]);
  assert.equal(notices.length, 1);
});

test("연속 업로드는 3초 디바운스로 한 장의 카드로 묶고 PDF 원본은 제외한다", async (t) => {
  const { notices, titles } = notificationEnv(t);
  const view = renderNotifications([]);
  assert.deepEqual(titles(), []);

  view.setDocuments([doc("n1")]);
  await advance(t, PROMPT_DEBOUNCE_MS - 1);
  view.setDocuments([doc("n1"), doc("n2"), doc("pdf1", "uploaded", { mime_type: "application/pdf" })]);
  await advance(t, PROMPT_DEBOUNCE_MS - 1);
  assert.deepEqual(titles(), [], "마지막 업로드 뒤 3초가 지나기 전에는 띄우지 않는다");

  await advance(t, 1);
  assert.deepEqual(titles(), ["새 문서가 추가되었습니다"]);
  assert.equal(notices[0].message, "2개 문서의 위키 편입을 시작해 보세요.");

  notices[0].action.onAction();
  await advance(t, 0);
  assert.deepEqual(reflectCalls, [["n1", "EDITABLE"], ["n2", "EDITABLE"]]);
});

test("편입 시작이 실패하면 백엔드 사유를 담은 실패 카드를 띄운다", async (t) => {
  const { notices, titles } = notificationEnv(t);
  renderNotifications([doc("f1")]);
  setReflectFailure(new Error("파이프라인 점검 중"));

  notices[0].action.onAction();
  await advance(t, 0);

  assert.deepEqual(titles(), ["위키 편입 대기 중인 문서가 있습니다", "위키 편입 시작 실패"]);
  assert.equal(notices[1].kind, "failed");
  assert.equal(notices[1].message, "f1.md: 파이프라인 점검 중");
});

test("60초 넘게 uploaded에 머문 문서는 한 번만 리마인드하고, 편입이 시작되면 추적을 지운다", async (t) => {
  const { titles } = notificationEnv(t);
  const view = renderNotifications([doc("s1")]);
  assert.deepEqual(titles(), ["위키 편입 대기 중인 문서가 있습니다"]);

  await advance(t, STALL_CHECK_MS);
  assert.equal(titles().length, 1, "30초 점검에서는 아직 정체가 아니다");
  await advance(t, STALL_CHECK_MS);
  assert.deepEqual(titles().at(-1), "위키 편입이 아직 시작되지 않았습니다");
  await advance(t, STALL_CHECK_MS * 4);
  assert.equal(titles().length, 2, "같은 문서를 다시 리마인드하지 않는다");

  // 편입이 시작돼 uploaded를 벗어나면 추적을 지우고, 다시 uploaded가 되면 처음부터 센다.
  view.setDocuments([doc("s1", "processing")]);
  view.setDocuments([doc("s1")]);
  await advance(t, STALL_MS);
  assert.equal(titles().length, 3);
  assert.deepEqual(titles().at(-1), "위키 편입이 아직 시작되지 않았습니다");
});

test("마지막 편입 이후 수정된 문서는 재편입을 제안하고 빈 목록에서는 제안 기록을 지우지 않는다", async (t) => {
  const { titles, storage } = notificationEnv(t);
  const edited = doc("r1", "completed", { needs_reingest: true });
  const view = renderNotifications([edited]);
  assert.deepEqual(titles(), ["마지막 위키 편입 이후 수정된 문서가 있습니다"]);

  view.setDocuments([edited]);
  assert.equal(titles().length, 1, "같은 문서를 다시 제안하지 않는다");
  assert.match(storage.get("fruition.pending_work_prompted"), /"reingest":\["r1"\]/);

  // 새로고침 직후 목록이 비어 있는 동안 기록을 지우면 목록 도착 때 같은 카드가 다시 뜬다.
  view.unmount();
  const reloaded = renderNotifications([]);
  reloaded.setDocuments([edited]);
  assert.equal(titles().length, 1);

  // 재편입이 시작돼 needs_reingest가 풀리면 다음 편집에서 다시 제안한다.
  reloaded.setDocuments([doc("r1", "completed")]);
  reloaded.setDocuments([edited]);
  assert.equal(titles().length, 2);
});

test("문서가 completed로 바뀌면 유지보수 상태를 확인해 lint가 필요할 때만 제안한다", async (t) => {
  const { notices, statusRequests, titles } = notificationEnv(t, { needsLint: true });
  const view = renderNotifications([doc("l1", "processing")]);
  assert.deepEqual(statusRequests, [], "첫 스냅샷에서는 확인하지 않는다");

  view.setDocuments([doc("l1", "completed")]);
  await advance(t, 0);
  assert.equal(statusRequests.length, 1);
  assert.deepEqual(titles(), ["Lint 제안"]);
  assert.equal(notices[0].action.label, "Lint");

  // 5분 안의 연속 완료는 다시 묻지 않는다.
  view.setDocuments([doc("l1", "completed"), doc("l2", "processing")]);
  view.setDocuments([doc("l1", "completed"), doc("l2", "completed")]);
  await advance(t, 0);
  assert.equal(statusRequests.length, 1);
});

test("lint가 필요 없으면 카드를 띄우지 않고 상태 조회 실패도 조용히 넘긴다", async (t) => {
  const { statusRequests, titles } = notificationEnv(t, { needsLint: false });
  const view = renderNotifications([doc("l1", "processing")]);

  view.setDocuments([doc("l1", "completed")]);
  await advance(t, 0);
  assert.equal(statusRequests.length, 1);
  assert.deepEqual(titles(), []);

  globalThis.fetch.mock.mockImplementation(async () => { throw new Error("Failed to fetch"); });
  t.mock.timers.tick(5 * 60_000);
  view.setDocuments([doc("l1", "completed"), doc("l2", "processing")]);
  view.setDocuments([doc("l1", "completed"), doc("l2", "completed")]);
  await advance(t, 0);
  assert.deepEqual(titles(), []);
});

test("제안 알림을 끄면 편입 제안과 lint 확인을 하지 않는다", async (t) => {
  const { statusRequests, titles } = notificationEnv(t, { needsLint: true });
  fakeUserPreferences.preferences = { notifications: { query: true, suggest: false } };
  const view = renderNotifications([doc("q1"), doc("q2", "processing")]);
  assert.deepEqual(titles(), []);

  view.setDocuments([doc("q1"), doc("q2", "completed"), doc("q3")]);
  await advance(t, PROMPT_DEBOUNCE_MS);
  assert.deepEqual(statusRequests, []);
  assert.deepEqual(titles(), []);
});

test("언마운트하면 디바운스 중인 제안과 정체 점검을 멈춘다", async (t) => {
  const { titles } = notificationEnv(t);
  const view = renderNotifications([]);
  view.setDocuments([doc("u1")]);

  view.unmount();
  await advance(t, STALL_MS * 2);

  assert.deepEqual(titles(), []);
});
