import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { createRouter, issueAccessToken, listen } from "../mock/lib/http.mjs";
import { state } from "../mock/state.mjs";
import { registerMeetingRoutes } from "../mock/routes/meetings.mjs";

// 앱의 경로 별칭과 확장자 없는 상대 import를 같은 소스(.ts)로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const { buildMeetingListQuery, MEETING_LIST_MAX_LIMIT, MEETING_LIST_DEFAULT_LIMIT } = await import("../src/entities/meeting/lib/meetingListQuery.ts");
const { meetingListBadge, MEETING_RESUME_MESSAGES, resumedMeetingView, shouldLoadNotesOnResume } = await import("../src/features/meeting-dictation/lib/meetingResume.ts");
const { canCloseMeetingInPhase, MEETING_MESSAGES } = await import("../src/features/meeting-dictation/lib/meetingNotesFlow.ts");

const segment = (position, text) => ({ id: `s1_${position}`, position, status: "completed", text });
const meetingOf = (overrides = {}) => ({ status: "open", source: "live", error: null, segments: [segment(1, "첫 문장")], live_connected: false, ...overrides });

test("회의 목록 쿼리: 상태가 없거나 비었으면 status를 아예 보내지 않는다(빈 status=는 전부로 읽힌다)", () => {
  assert.equal(buildMeetingListQuery(), "");
  assert.equal(buildMeetingListQuery({ statuses: [] }), "");
  assert.equal(buildMeetingListQuery({ statuses: [""] }), "");
  assert.doesNotMatch(buildMeetingListQuery({ statuses: [], cursor: "c1" }), /status=/);
});

test("회의 목록 쿼리: 상태는 쉼표 목록(중복 제거), cursor·limit을 붙이고 limit은 1~100으로 맞춘다", () => {
  assert.equal(buildMeetingListQuery({ statuses: ["transcribing", "open", "open"] }), "?status=transcribing,open");
  assert.equal(buildMeetingListQuery({ cursor: "abc/+=", limit: 20 }), "?cursor=abc%2F%2B%3D&limit=20");
  assert.equal(buildMeetingListQuery({ cursor: null, limit: 500 }), `?limit=${MEETING_LIST_MAX_LIMIT}`);
  assert.equal(buildMeetingListQuery({ limit: 0 }), `?limit=${MEETING_LIST_DEFAULT_LIMIT}`);
  assert.equal(buildMeetingListQuery({ limit: Number.NaN }), `?limit=${MEETING_LIST_DEFAULT_LIMIT}`);
});

test("다시 열기: 전사 중은 진행 표시(조회 대기), 실패는 서버 사유, 올리기 전은 다시 올리기 안내로 연다", () => {
  assert.deepEqual(resumedMeetingView(meetingOf({ status: "transcribing", source: "upload", segments: [] }), null), { phase: "transcribing", notice: null });
  const failed = resumedMeetingView(meetingOf({ status: "failed", source: "upload", error: "음성이 없습니다." }), null);
  assert.equal(failed.phase, "stopped");
  assert.equal(failed.notice.tone, "error");
  assert.match(failed.notice.text, /음성이 없습니다/);
  assert.deepEqual(resumedMeetingView(meetingOf({ status: "awaiting_upload", source: "upload", segments: [] }), null), {
    phase: "stopped", notice: { text: MEETING_RESUME_MESSAGES.awaitingUpload, tone: "info" }
  });
  for (const status of ["transcribing", "failed", "awaiting_upload"]) {
    assert.equal(shouldLoadNotesOnResume(meetingOf({ status }), { has_notes: true }), false, status);
  }
});

test("다시 열기: 회의록 초안은 있을 만할 때만 조회한다(없는 초안 조회는 404라 콘솔 오류가 남는다)", () => {
  // 목록이 ready·applied 초안이 있다고 하면 조회한다.
  assert.equal(shouldLoadNotesOnResume(meetingOf(), { has_notes: true }), true);
  // has_notes는 생성 중·실패 초안을 세지 않으므로, 받아쓴 문장이 있으면 그대로 조회해 생성 중·실패 화면을 놓치지 않는다.
  assert.equal(shouldLoadNotesOnResume(meetingOf(), { has_notes: false }), true);
  // 받아쓴 문장이 없으면 초안을 만들 수 없으니 조회하지 않는다.
  assert.equal(shouldLoadNotesOnResume(meetingOf({ segments: [] }), { has_notes: false }), false);
  const unfinishedOnly = meetingOf({ segments: [{ id: "s1_1", position: 1, status: "partial", text: "말하는 중" }] });
  assert.equal(shouldLoadNotesOnResume(unfinishedOnly, { has_notes: false }), false);
});

test("다시 열기: 끝난 회의는 회의록 초안 상태대로(생성 중·회의록·저장됨) 열고, 없으면 받아쓴 내용으로 연다", () => {
  assert.equal(resumedMeetingView(meetingOf(), { status: "generating", error_code: null }).phase, "generating");
  assert.equal(resumedMeetingView(meetingOf(), { status: "ready", error_code: null }).phase, "ready");
  assert.equal(resumedMeetingView(meetingOf({ source: "upload" }), { status: "applied", error_code: null }).phase, "applied");
  assert.deepEqual(resumedMeetingView(meetingOf(), null), { phase: "stopped", notice: null });
  const failedNotes = resumedMeetingView(meetingOf(), { status: "failed", error_code: "MEETING_NOTES_TIMEOUT" });
  assert.equal(failedNotes.phase, "stopped");
  assert.equal(failedNotes.notice.tone, "error");
  assert.equal(resumedMeetingView(meetingOf(), { status: "failed", error_code: "MEETING_NOTES_CANCELLED" }).notice.tone, "info");
});

test("다시 열기: 받아쓴 문장이 없으면 회의록을 만들 수 없다고, 다른 화면에서 받아쓰는 중이면 그렇다고 알린다", () => {
  assert.equal(resumedMeetingView(meetingOf({ segments: [] }), null).notice.text, MEETING_MESSAGES.emptyTranscript);
  assert.equal(resumedMeetingView(meetingOf({ source: "upload", segments: [] }), null).notice.text, MEETING_MESSAGES.emptyRecordingTranscript);
  assert.equal(resumedMeetingView(meetingOf({ live_connected: true }), null).notice.text, MEETING_RESUME_MESSAGES.liveConnected);
});

test("목록 표시: 전사 중·실패를 먼저 알리고, 끝난 회의는 회의록 여부를 보여 준다", () => {
  assert.deepEqual(meetingListBadge({ status: "transcribing", has_notes: false, source: "upload" }), { label: "전사 중", tone: "progress" });
  assert.deepEqual(meetingListBadge({ status: "failed", has_notes: false, source: "upload" }), { label: "전사 실패", tone: "error" });
  assert.equal(meetingListBadge({ status: "awaiting_upload", has_notes: false, source: "upload" }).label, "올리기 전");
  assert.equal(meetingListBadge({ status: "open", has_notes: true, source: "live" }).label, "회의록 있음");
  assert.equal(meetingListBadge({ status: "open", has_notes: false, source: "upload" }).label, "전사 완료");
  assert.equal(meetingListBadge({ status: "open", has_notes: false, source: "live" }).label, "받아쓰기");
});

test("전사·회의록 생성·불러오기 중에는 회의 화면을 닫을 수 있고, 올리는 중·받아쓰는 중에는 닫을 수 없다", () => {
  for (const phase of ["transcribing", "generating", "opening", "stopped", "ready", "applied", "previewing"]) assert.equal(canCloseMeetingInPhase(phase), true, phase);
  for (const phase of ["idle", "uploading", "recording", "starting", "finishing", "saving", "deleting"]) assert.equal(canCloseMeetingInPhase(phase), false, phase);
});

test("mock 회의 목록: 내 회의만 cursor 페이지로, status 필터·잘못된 값은 400", async (t) => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const userId = `user_list_${suffix}`;
  const otherId = `user_list_other_${suffix}`;
  const workspaceId = `ws_list_${suffix}`;
  state.users.push({ id: userId }, { id: otherId });
  state.workspaces.push({ id: workspaceId, name: "list" });
  state.members.push({ workspace_id: workspaceId, user_id: userId, role: "OWNER" }, { workspace_id: workspaceId, user_id: otherId, role: "MEMBER" });
  const router = createRouter(state);
  registerMeetingRoutes(router);
  const server = await listen(router, 0);
  t.mock.method(console, "log", () => {});
  t.after(() => server.close());
  const port = server.address().port;
  const call = (user, path, init = {}) => fetch(`http://localhost:${port}/api/workspaces/${workspaceId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${issueAccessToken(state, user)}`, "Content-Type": "application/json", ...init.headers }
  });
  const create = (user, source) => call(user, "/meetings", { method: "POST", body: JSON.stringify({ source }), headers: { "Idempotency-Key": crypto.randomUUID() } });
  for (const source of ["live", "upload", "live"]) assert.equal((await create(userId, source)).status, 201);
  assert.equal((await create(otherId, "live")).status, 201);

  const first = await (await call(userId, "/meetings?limit=2")).json();
  assert.equal(first.items.length, 2);
  assert.ok(first.next_cursor);
  const second = await (await call(userId, `/meetings?limit=2&cursor=${first.next_cursor}`)).json();
  assert.equal(second.items.length, 1);
  assert.equal(second.next_cursor, null);
  const all = [...first.items, ...second.items];
  assert.deepEqual(Object.keys(all[0]).sort(), ["created_at", "display_name", "has_notes", "has_recording", "meeting_id", "source", "status", "updated_at"]);
  assert.equal(new Set(all.map((item) => item.meeting_id)).size, 3);

  const waiting = await (await call(userId, "/meetings?status=awaiting_upload")).json();
  assert.deepEqual(waiting.items.map((item) => item.source), ["upload"]);
  assert.equal((await (await call(userId, "/meetings?status=")).json()).items.length, 3);
  assert.equal((await call(userId, "/meetings?status=done")).status, 400);
  assert.equal((await call(userId, "/meetings?cursor=-1")).status, 400);
});
