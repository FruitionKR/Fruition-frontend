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
const { setVisibleNoticeSubjects, subscribeNotices } = await import("../src/features/document-notifications/model/noticeBus.ts");
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
  t.after(() => {
    unsubscribe();
    setVisibleNoticeSubjects(new Set());
  });
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

const ALLOWED = { canIngest: true, canLint: true };

function renderNotifications(documents, permissions = ALLOWED) {
  const props = { documents, permissions };
  const view = render(() => usePendingWorkNotifications(props.documents, props.permissions));
  return {
    setDocuments(next) {
      props.documents = next;
      view.rerender();
    },
    setPermissions(next) {
      props.permissions = next;
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
  assert.deepEqual(titles(), ["위키 최신화 제안"]);
  assert.equal(notices[0].action.label, "위키 최신화");

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

test("제안 카드는 최신 문서 목록에 맞춰 삭제된 문서를 빼고 바뀐 이름을 반영하며, 다룰 문서가 없으면 내린다", (t) => {
  const { notices } = notificationEnv(t);
  renderNotifications([doc("a"), doc("b")]);
  const card = notices[0];
  assert.deepEqual(card.subjectIds, ["a", "b"]);

  // b 삭제 + a 이름 변경
  assert.deepEqual(card.reconcile([doc("a", "uploaded", { filename: "새 이름.md" })]), {
    message: '"새 이름.md" 문서의 위키 편입을 시작해 보세요.',
    subjectIds: ["a"]
  });
  // 편입이 시작됐거나(processing) 끝난(completed) 문서만 남으면 카드를 내린다.
  assert.equal(card.reconcile([doc("a", "processing"), doc("b", "completed")]), null);
  assert.equal(card.reconcile([]), null);
});

test("제안 카드 버튼은 누르는 시점의 목록으로 대상을 다시 골라 삭제·편입 중인 문서를 건너뛴다", async (t) => {
  const { notices, titles } = notificationEnv(t);
  let refreshCount = 0;
  const view = renderNotifications([doc("a"), doc("b"), doc("c")], { ...ALLOWED, onIngestStarted: () => { refreshCount += 1; } });

  // a는 삭제, b는 다른 경로로 편입 시작
  view.setDocuments([doc("b", "processing"), doc("c")]);
  notices[0].action.onAction();
  await advance(t, 0);

  assert.deepEqual(reflectCalls, [["c", "EDITABLE"]]);
  assert.equal(refreshCount, 1, "요청이 접수되면 문서 목록을 다시 받아 빠른 폴링으로 바꾼다");
  assert.ok(!titles().includes("위키 편입 시작 실패"), "삭제된 문서로 404를 내지 않는다");
});

test("대상 문서가 모두 사라진 카드의 버튼은 아무 요청도 보내지 않는다", async (t) => {
  const { notices } = notificationEnv(t);
  const view = renderNotifications([doc("a")]);

  view.setDocuments([doc("a", "completed")]);
  notices[0].action.onAction();
  await advance(t, 0);

  assert.deepEqual(reflectCalls, []);
});

test("편입한 적 없는 문서는 needs_reingest여도 재편입(수정됨) 제안을 띄우지 않는다", (t) => {
  const { titles } = notificationEnv(t);
  renderNotifications([
    doc("new-note", "uploaded", { needs_reingest: true }),
    doc("converted", "completed", { needs_reingest: true, pipeline_run_id: "convert:converted" })
  ]);

  assert.deepEqual(titles(), ["위키 편입 대기 중인 문서가 있습니다"]);
});

test("위키 편입 권한이 없으면 편입·재편입 제안을 띄우지 않고, 권한 확인 전에는 기다렸다가 확인되면 제안한다", async (t) => {
  const { titles } = notificationEnv(t);
  const denied = renderNotifications([doc("a"), doc("r", "completed", { needs_reingest: true })], { canIngest: false, canLint: false });
  await advance(t, STALL_MS * 2);
  assert.deepEqual(titles(), []);
  denied.unmount();

  const pending = renderNotifications([doc("b")], { canIngest: null, canLint: null });
  assert.deepEqual(titles(), [], "역할 확인 전에는 첫 스냅샷으로 삼지 않는다");
  pending.setPermissions(ALLOWED);
  assert.deepEqual(titles(), ["위키 편입 대기 중인 문서가 있습니다"]);
});

test("위키 최신화 권한이 없으면 유지보수 상태를 묻지 않고 최신화 제안도 띄우지 않는다", async (t) => {
  const { statusRequests, titles } = notificationEnv(t, { needsLint: true });
  const view = renderNotifications([doc("l1", "processing")], { canIngest: true, canLint: false });

  view.setDocuments([doc("l1", "completed")]);
  await advance(t, 0);

  assert.deepEqual(statusRequests, []);
  assert.deepEqual(titles(), []);
});

test("제안 카드가 내려간 직후에는 리마인드하지 않고, 사라진 뒤 60초가 지나야 다시 본다", async (t) => {
  const { titles } = notificationEnv(t);
  const view = renderNotifications([doc("s1")]);
  assert.deepEqual(titles(), ["위키 편입 대기 중인 문서가 있습니다"]);

  // 카드가 70초 동안 보이다가(대기열 포함) 사라진다.
  setVisibleNoticeSubjects(new Set(["s1"]));
  await advance(t, 70_000);
  assert.equal(titles().length, 1, "카드가 보이는 동안에는 리마인드하지 않는다");
  setVisibleNoticeSubjects(new Set());

  // 문서 목록이 바뀔 때마다 점검해도 곧바로 다시 띄우지 않는다.
  view.setDocuments([doc("s1", "uploaded", { updated_at: "x" })]);
  await advance(t, 1_000);
  view.setDocuments([doc("s1", "uploaded", { updated_at: "y" })]);
  assert.equal(titles().length, 1);

  await advance(t, STALL_MS);
  view.setDocuments([doc("s1", "uploaded", { updated_at: "z" })]);
  assert.deepEqual(titles().at(-1), "위키 편입이 아직 시작되지 않았습니다");
  assert.equal(titles().length, 2);
});
