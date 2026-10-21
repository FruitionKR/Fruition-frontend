import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTaskNotifications,
  buildWorkspaceNotifications,
  countUnreadNotifications,
  formatNotificationTime,
  isNotificationUnread,
  markAllNotificationsRead,
  markNotificationRead,
  MAX_READ_IDS,
  parseReadState,
  readStateStorageKey
} from "../src/widgets/notifications-view/lib/notificationFeed.ts";

const log = (overrides) => ({
  operation_id: "op1",
  operation_type: "ingest",
  status: "succeeded",
  target_document_id: "d1",
  target_display_name: "회의록.md",
  summary: "위키 페이지 3개 생성",
  changed_resource_count: 3,
  restored_from: null,
  created_at: "2026-10-09T01:00:00Z",
  completed_at: "2026-10-09T01:05:00Z",
  ...overrides
});

const member = (overrides) => ({
  user_id: "u2",
  email: "kim@example.com",
  display_name: "김철수",
  provider: "local",
  role: "MEMBER",
  joined_at: "2026-10-08T00:00:00Z",
  ...overrides
});

test("종결된 작업 로그를 작업 알림으로 바꾸고 최신순으로 정렬한다", () => {
  const items = buildTaskNotifications([
    log({ operation_id: "a", completed_at: "2026-10-09T01:00:00Z" }),
    log({ operation_id: "b", operation_type: "lint", status: "failed", target_display_name: null, summary: "LLM 오류", completed_at: "2026-10-09T02:00:00Z" })
  ]);
  assert.deepEqual(items.map((item) => item.id), ["task:b", "task:a"]);
  assert.equal(items[0].title, "위키 최신화 실패");
  assert.equal(items[0].description, "LLM 오류");
  assert.equal(items[0].tone, "failure");
  assert.equal(items[0].operationId, "b");
  assert.equal(items[1].title, "문서 처리 완료");
  assert.equal(items[1].description, "회의록.md / 위키 페이지 3개 생성");
  assert.equal(items[1].changeCount, 3);
  assert.equal(items[1].occurredAt, Date.parse("2026-10-09T01:00:00Z"));
});

test("진행 중 작업과 바꾼 문서가 없는 성공 lint는 알림에서 뺀다", () => {
  const items = buildTaskNotifications([
    log({ operation_id: "running", status: "processing", completed_at: null }),
    log({ operation_id: "noop", operation_type: "lint", status: "succeeded", changed_resource_count: 0 }),
    log({ operation_id: "restore", operation_type: "restore", status: "conflict", changed_resource_count: 0, summary: null, target_display_name: null })
  ]);
  assert.deepEqual(items.map((item) => item.id), ["task:restore"]);
  assert.equal(items[0].title, "복구(롤백) 충돌");
  assert.equal(items[0].description, "복구(롤백) 작업이 충돌로 끝났습니다.");
  assert.equal(items[0].changeCount, null);
});

test("일부 성공·AI 편집 작업 제목, 완료 시각이 없으면 생성 시각을 쓴다", () => {
  const [item] = buildTaskNotifications([
    log({ operation_type: "document_edit", status: "partially_succeeded", completed_at: null })
  ]);
  assert.equal(item.title, "AI 편집 반영 일부 완료");
  assert.equal(item.tone, "success");
  assert.equal(item.occurredAt, Date.parse("2026-10-09T01:00:00Z"));
});

test("나를 뺀 멤버 참여를 워크스페이스 알림으로 만든다", () => {
  const items = buildWorkspaceNotifications([
    member({ user_id: "me", joined_at: "2026-10-09T00:00:00Z" }),
    member({ user_id: "u2" }),
    member({ user_id: "u3", display_name: null, email: "lee@example.com", joined_at: "2026-10-09T03:00:00Z" })
  ], "me");
  assert.deepEqual(items.map((item) => item.id), ["member:u3", "member:u2"]);
  assert.equal(items[0].title, "새 멤버 참여");
  assert.equal(items[0].description, "lee@example.com님이 워크스페이스에 참여했습니다.");
  assert.equal(items[1].description, "김철수님이 워크스페이스에 참여했습니다.");
});

test("날짜를 읽을 수 없는 항목은 버린다", () => {
  assert.equal(buildWorkspaceNotifications([member({ joined_at: "invalid" })], null).length, 0);
  assert.equal(buildTaskNotifications([log({ completed_at: null, created_at: "" })]).length, 0);
});

test("읽음 상태는 마지막 읽은 시각 이후이면서 개별로 읽지 않은 알림만 안 읽음으로 본다", () => {
  const state = { lastReadAt: 100, readIds: ["task:read"] };
  assert.equal(isNotificationUnread({ id: "task:old", occurredAt: 100 }, state), false);
  assert.equal(isNotificationUnread({ id: "task:new", occurredAt: 101 }, state), true);
  assert.equal(isNotificationUnread({ id: "task:read", occurredAt: 200 }, state), false);
  assert.equal(countUnreadNotifications([
    { id: "a", occurredAt: 50 },
    { id: "b", occurredAt: 150 },
    { id: "task:read", occurredAt: 150 }
  ], state), 1);
});

test("개별 읽음은 새 상태를 돌려주고 기록 개수를 제한한다", () => {
  const state = { lastReadAt: 0, readIds: ["x"] };
  const next = markNotificationRead(state, "y");
  assert.deepEqual(next.readIds, ["x", "y"]);
  assert.deepEqual(state.readIds, ["x"]);
  assert.equal(markNotificationRead(next, "y"), next);
  const many = { lastReadAt: 0, readIds: Array.from({ length: MAX_READ_IDS }, (_, index) => `id${index}`) };
  const capped = markNotificationRead(many, "last");
  assert.equal(capped.readIds.length, MAX_READ_IDS);
  assert.equal(capped.readIds.at(-1), "last");
  assert.equal(capped.readIds[0], "id1");
});

test("전체 읽음은 지금과 가장 늦은 알림 시각 중 늦은 쪽을 기준으로 삼는다", () => {
  assert.deepEqual(markAllNotificationsRead([{ id: "a", occurredAt: 500 }], 300), { lastReadAt: 500, readIds: [] });
  assert.deepEqual(markAllNotificationsRead([{ id: "a", occurredAt: 100 }], 300), { lastReadAt: 300, readIds: [] });
});

test("저장된 읽음 상태를 읽고, 없거나 깨졌으면 null을 돌려준다", () => {
  assert.deepEqual(parseReadState(JSON.stringify({ lastReadAt: 10, readIds: ["a", 1] })), { lastReadAt: 10, readIds: ["a"] });
  assert.equal(parseReadState(null), null);
  assert.equal(parseReadState("{"), null);
  assert.equal(parseReadState(JSON.stringify({ lastReadAt: "x" })), null);
  assert.deepEqual(parseReadState(JSON.stringify({ lastReadAt: 5 })), { lastReadAt: 5, readIds: [] });
});

test("읽음 상태 저장 키는 사용자·워크스페이스별로 나뉜다", () => {
  assert.equal(readStateStorageKey("u1", "w1"), "fruition.notifications_read.u1.w1");
  assert.notEqual(readStateStorageKey("u1", "w1"), readStateStorageKey("u1", "w2"));
});

test("상대 시간: 지금 → 분 → 시간 → 일 → 날짜", () => {
  const now = new Date(2026, 9, 9, 12, 0, 0).getTime();
  const minute = 60_000;
  assert.equal(formatNotificationTime(now - 30_000, now), "지금");
  assert.equal(formatNotificationTime(now + 5 * minute, now), "지금");
  assert.equal(formatNotificationTime(now - minute, now), "1분 전");
  assert.equal(formatNotificationTime(now - 59 * minute, now), "59분 전");
  assert.equal(formatNotificationTime(now - 60 * minute, now), "1시간 전");
  assert.equal(formatNotificationTime(now - 23 * 60 * minute, now), "23시간 전");
  assert.equal(formatNotificationTime(now - 24 * 60 * minute, now), "1일 전");
  assert.equal(formatNotificationTime(now - 6 * 24 * 60 * minute, now), "6일 전");
  assert.equal(formatNotificationTime(new Date(2026, 8, 1, 12).getTime(), now), "9월 1일");
  assert.equal(formatNotificationTime(new Date(2025, 11, 31, 12).getTime(), now), "2025년 12월 31일");
});

test("알림을 누르면 펼칠 짧은 설명: 작업은 결과·대상·요약·변경 수", () => {
  const [item] = buildTaskNotifications([log({})]);
  assert.deepEqual(item.details, [
    "문서 처리 작업이 완료되었습니다.",
    "대상 문서: 회의록.md",
    "요약: 위키 페이지 3개 생성",
    "바뀐 문서 3개"
  ]);
  const [bare] = buildTaskNotifications([
    log({ operation_type: "restore", status: "failed", target_display_name: null, summary: null, changed_resource_count: 0 })
  ]);
  assert.deepEqual(bare.details, ["복구(롤백) 작업이 실패했습니다."]);
});

test("알림을 누르면 펼칠 짧은 설명: 멤버 참여는 이름·이메일·역할", () => {
  const [item] = buildWorkspaceNotifications([member({})], "u1");
  assert.deepEqual(item.details, ["김철수 (kim@example.com)", "역할: 멤버"]);
  const [owner] = buildWorkspaceNotifications([member({ display_name: null, role: "OWNER" })], "u1");
  assert.deepEqual(owner.details, ["kim@example.com", "역할: 소유자"]);
});
