import assert from "node:assert/strict";
import test from "node:test";
import { createRouter, issueAccessToken, listen } from "../mock/lib/http.mjs";
import { state } from "../mock/state.mjs";
import { registerMeetingRoutes } from "../mock/routes/meetings.mjs";

/** mock 회의 받아쓰기 라우트(#148)가 document meetings.md 계약대로 REST·WebSocket을 돌려주는지 확인한다. */
async function startMock(t) {
  process.env.MOCK_MEETING_DELAY_MS = "0";
  process.env.MOCK_MEETING_NOTES_DELAY_MS = "0";
  t.after(() => {
    delete process.env.MOCK_MEETING_DELAY_MS;
    delete process.env.MOCK_MEETING_NOTES_DELAY_MS;
    delete process.env.MOCK_MEETING_LIVE_ERROR;
  });
  const suffix = Math.random().toString(36).slice(2, 8);
  const userId = `user_mtg_${suffix}`;
  const workspaceId = `ws_mtg_${suffix}`;
  state.users.push({ id: userId });
  state.workspaces.push({ id: workspaceId, name: "meeting" });
  state.members.push({ workspace_id: workspaceId, user_id: userId, role: "OWNER" });
  const documentId = `doc_mtg_${suffix}`;
  state.documents.push({
    id: documentId, workspace_id: workspaceId, filename: "주간 회의.md", mime_type: "text/markdown", status: "uploaded",
    document_role: "EDITABLE", markdown: "# 주간 회의\n\n기존 내용\n\n", owner_user_id: userId, permission: null,
    folder_id: null, current_version: 3, edit_revision: 3, versions: []
  });
  const router = createRouter(state);
  registerMeetingRoutes(router);
  const server = await listen(router, 0);
  t.mock.method(console, "log", () => {});
  t.after(() => server.close());
  const port = server.address().port;
  const token = issueAccessToken(state, userId);
  const api = (path, init = {}) => fetch(`http://localhost:${port}/api/workspaces/${workspaceId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers }
  });
  const post = (path, body, headers = {}) => api(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers });
  const socketUrl = (meetingId, ticket) => `ws://localhost:${port}/api/meetings/${meetingId}/live?ticket=${ticket}`;
  return { api, post, socketUrl, documentId };
}

/** WebSocket을 열고 받은 이벤트를 모은다. ready를 기다린 뒤 돌려준다. */
async function openLive(url) {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const events = [];
  const waiters = [];
  socket.addEventListener("message", (message) => {
    events.push(JSON.parse(message.data));
    for (const waiter of [...waiters]) waiter();
  });
  const closed = new Promise((resolve) => socket.addEventListener("close", (event) => resolve(event.code)));
  const waitFor = (predicate) => new Promise((resolve) => {
    const check = () => {
      if (!predicate(events)) return;
      waiters.splice(waiters.indexOf(check), 1);
      resolve(events);
    };
    waiters.push(check);
    check();
  });
  await waitFor((list) => list.some((event) => event.type === "ready"));
  return { socket, events, waitFor, closed };
}

async function createLiveMeeting(post, body = {}) {
  const response = await post("/meetings", { source: "live", ...body }, { "Idempotency-Key": crypto.randomUUID() });
  assert.equal(response.status, 201);
  return response.json();
}

async function ticketFor(post, meetingId) {
  const response = await post(`/meetings/${meetingId}/live-tickets`);
  assert.equal(response.status, 200);
  return (await response.json()).ticket;
}

const audioSecond = () => new Uint8Array(48_000);

test("회의를 만들고 실시간으로 받아쓰면 committed·delta·completed 뒤 finish로 finished와 close 1000을 받는다", async (t) => {
  const { post, api, socketUrl, documentId } = await startMock(t);
  const meeting = await createLiveMeeting(post, { document_id: documentId });
  assert.equal(meeting.status, "open");
  assert.equal(meeting.document_id, documentId);
  const live = await openLive(socketUrl(meeting.meeting_id, await ticketFor(post, meeting.meeting_id)));
  live.socket.send(audioSecond());
  live.socket.send(JSON.stringify({ type: "commit" }));
  await live.waitFor((events) => events.some((event) => event.type === "completed"));
  live.socket.send(audioSecond());
  live.socket.send(JSON.stringify({ type: "finish" }));
  assert.equal(await live.closed, 1000);
  const types = live.events.map((event) => event.type);
  assert.equal(types[0], "ready");
  assert.ok(types.includes("committed") && types.includes("delta"));
  assert.deepEqual(live.events.at(-1), { type: "finished", segment_count: 2 });

  const latest = await (await api(`/meetings/${meeting.meeting_id}`)).json();
  assert.equal(latest.live_connected, false);
  assert.equal(latest.transcript_complete, true);
  assert.deepEqual(latest.segments.map((segment) => segment.position), [1, 2]);
  assert.deepEqual(latest.streams, [{ stream_order: 1, end_reason: "finished" }]);
});

test("ticket은 한 번만 쓰이고, 같은 회의에 이미 연결이 있으면 4409로 닫는다", async (t) => {
  const { post, socketUrl } = await startMock(t);
  const meeting = await createLiveMeeting(post);
  const ticket = await ticketFor(post, meeting.meeting_id);
  const live = await openLive(socketUrl(meeting.meeting_id, ticket));
  // 연결 중에는 새 ticket도 409 MEETING_LIVE_IN_USE다.
  const busy = await post(`/meetings/${meeting.meeting_id}/live-tickets`);
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).error.code, "MEETING_LIVE_IN_USE");
  // 쓴 ticket을 다시 쓰면 handshake가 거절된다(브라우저에는 1006).
  const reused = new WebSocket(socketUrl(meeting.meeting_id, ticket));
  assert.equal(await new Promise((resolve) => reused.addEventListener("close", (event) => resolve(event.code))), 1006);
  live.socket.close(1000);
  await live.closed;
});

test("ready 전 오디오와 48,000 bytes 넘는 frame은 invalid_audio로 닫는다", async (t) => {
  const { post, socketUrl } = await startMock(t);
  const meeting = await createLiveMeeting(post);
  const live = await openLive(socketUrl(meeting.meeting_id, await ticketFor(post, meeting.meeting_id)));
  live.socket.send(new Uint8Array(48_002));
  assert.equal(await live.closed, 1008);
  assert.equal(live.events.at(-1).code, "invalid_audio");
});

test("크레딧 부족은 error insufficient_credit 뒤 1008로 닫고 저장된 구간은 남는다", async (t) => {
  const { post, api, socketUrl } = await startMock(t);
  process.env.MOCK_MEETING_LIVE_ERROR = "insufficient_credit";
  const meeting = await createLiveMeeting(post);
  const live = await openLive(socketUrl(meeting.meeting_id, await ticketFor(post, meeting.meeting_id)));
  for (let index = 0; index < 3; index += 1) {
    live.socket.send(audioSecond());
    live.socket.send(JSON.stringify({ type: "commit" }));
  }
  assert.equal(await live.closed, 1008);
  assert.equal(live.events.find((event) => event.type === "error").code, "insufficient_credit");
  const latest = await (await api(`/meetings/${meeting.meeting_id}`)).json();
  assert.equal(latest.segments.length, 2);
  assert.equal(latest.streams[0].end_reason, "interrupted");
  assert.equal(latest.transcript_complete, false);
});

test("회의록: 비어 있으면 422, 끊긴 연결이 있으면 allow_partial 없이 409, 생성은 202 뒤 조회로 ready", async (t) => {
  const { post, api, socketUrl } = await startMock(t);
  const empty = await createLiveMeeting(post);
  const emptyResponse = await post(`/meetings/${empty.meeting_id}/notes`, undefined, { "Idempotency-Key": "k-empty" });
  assert.equal(emptyResponse.status, 422);
  assert.equal((await emptyResponse.json()).error.code, "MEETING_TRANSCRIPT_EMPTY");

  const meeting = await createLiveMeeting(post);
  const live = await openLive(socketUrl(meeting.meeting_id, await ticketFor(post, meeting.meeting_id)));
  live.socket.send(audioSecond());
  live.socket.send(JSON.stringify({ type: "commit" }));
  await live.waitFor((events) => events.some((event) => event.type === "completed"));
  live.socket.close(1000);
  await live.closed;
  await new Promise((resolve) => setTimeout(resolve, 20));

  const incomplete = await post(`/meetings/${meeting.meeting_id}/notes`, undefined, { "Idempotency-Key": "k-1" });
  assert.equal(incomplete.status, 409);
  assert.equal((await incomplete.json()).error.code, "MEETING_TRANSCRIPT_INCOMPLETE");

  const requested = await api(`/meetings/${meeting.meeting_id}/notes?allow_partial=true`, { method: "POST", headers: { "Idempotency-Key": "k-2" } });
  assert.equal(requested.status, 202);
  const generating = await requested.json();
  assert.equal(generating.status, "generating");
  assert.equal(generating.partial, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const ready = await (await api(`/meetings/${meeting.meeting_id}/notes`)).json();
  assert.equal(ready.status, "ready");
  assert.match(ready.markdown, /^# 회의록\n\n## 요약\n- /);
  assert.match(ready.markdown, /## 미결 사항\n- 확인된 내용 없음$/);
});

async function readyMeeting(post, api, socketUrl, body = {}) {
  const meeting = await createLiveMeeting(post, body);
  const live = await openLive(socketUrl(meeting.meeting_id, await ticketFor(post, meeting.meeting_id)));
  live.socket.send(audioSecond());
  live.socket.send(JSON.stringify({ type: "finish" }));
  await live.closed;
  const requested = await post(`/meetings/${meeting.meeting_id}/notes`, undefined, { "Idempotency-Key": crypto.randomUUID() });
  assert.equal(requested.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const notes = await (await api(`/meetings/${meeting.meeting_id}/notes`)).json();
  assert.equal(notes.status, "ready");
  return { meeting, notes };
}

test("같은 워크스페이스에서 회의록을 만드는 중이면 다른 회의도 409 MEETING_NOTES_BUSY, 취소하면 자리가 풀린다", async (t) => {
  const { post, api, socketUrl } = await startMock(t);
  process.env.MOCK_MEETING_NOTES_DELAY_MS = "60000";
  const first = await createLiveMeeting(post);
  const second = await createLiveMeeting(post);
  for (const meeting of [first, second]) {
    const live = await openLive(socketUrl(meeting.meeting_id, await ticketFor(post, meeting.meeting_id)));
    live.socket.send(audioSecond());
    live.socket.send(JSON.stringify({ type: "finish" }));
    await live.closed;
  }
  assert.equal((await post(`/meetings/${first.meeting_id}/notes`, undefined, { "Idempotency-Key": "a" })).status, 202);
  const busy = await post(`/meetings/${second.meeting_id}/notes`, undefined, { "Idempotency-Key": "b" });
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).error.code, "MEETING_NOTES_BUSY");
  // 같은 키 재시도는 BUSY가 아니라 같은 버전이다.
  assert.equal((await post(`/meetings/${first.meeting_id}/notes`, undefined, { "Idempotency-Key": "a" })).status, 202);
  const cancelled = await (await post(`/meetings/${first.meeting_id}/notes/cancel`)).json();
  assert.deepEqual([cancelled.status, cancelled.error_code], ["failed", "MEETING_NOTES_CANCELLED"]);
  assert.equal((await post(`/meetings/${first.meeting_id}/notes/cancel`)).status, 409);
  assert.equal((await post(`/meetings/${second.meeting_id}/notes`, undefined, { "Idempotency-Key": "c" })).status, 202);
  void api;
});

test("새 문서로 저장(create)하면 Markdown 문서가 생기고 같은 키 재시도는 같은 결과, 다른 키는 409 ALREADY_APPLIED", async (t) => {
  const { post, api, socketUrl } = await startMock(t);
  const { meeting, notes } = await readyMeeting(post, api, socketUrl);
  const apply = (key) => post(`/meetings/${meeting.meeting_id}/notes/${notes.version}/apply`, { mode: "create" }, { "Idempotency-Key": key });
  const saved = await (await apply("save-1")).json();
  assert.equal(saved.status, "applied");
  assert.equal(saved.applied.mode, "create");
  const doc = state.documents.find((item) => item.id === saved.applied.document_id);
  assert.equal(doc.filename, "회의록.md");
  assert.equal(doc.markdown, notes.markdown);
  assert.equal((await apply("save-1")).status, 200);
  const again = await apply("save-2");
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error.code, "MEETING_NOTES_ALREADY_APPLIED");
});

test("기존 문서 끝에 추가: 미리보기의 base_revision으로 저장하고, 그사이 문서가 바뀌면 409 DOCUMENT_REVISION_CHANGED", async (t) => {
  const { post, api, socketUrl, documentId } = await startMock(t);
  const { meeting, notes } = await readyMeeting(post, api, socketUrl, { document_id: documentId });
  const preview = await (await post(`/meetings/${meeting.meeting_id}/notes/${notes.version}/append-preview`, {})).json();
  assert.equal(preview.document_id, documentId);
  assert.equal(preview.base_revision, 3);
  assert.equal(preview.markdown, `# 주간 회의\n\n기존 내용\n\n${notes.markdown}\n`);

  const doc = state.documents.find((item) => item.id === documentId);
  doc.edit_revision = 4;
  const stale = await post(`/meetings/${meeting.meeting_id}/notes/${notes.version}/apply`, { mode: "append", base_revision: 3 }, { "Idempotency-Key": "stale" });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "DOCUMENT_REVISION_CHANGED");

  const saved = await (await post(`/meetings/${meeting.meeting_id}/notes/${notes.version}/apply`, { mode: "append", base_revision: 4 }, { "Idempotency-Key": "fresh" })).json();
  assert.deepEqual([saved.status, saved.applied.mode, saved.applied.document_id], ["applied", "append", documentId]);
  assert.equal(doc.markdown, preview.markdown);
});

test("남의 회의는 404로 숨긴다", async (t) => {
  const { post, api } = await startMock(t);
  const meeting = await createLiveMeeting(post);
  const owner = state.meetings.find((item) => item.meeting_id === meeting.meeting_id);
  owner.owner_user_id = "someone_else";
  const response = await api(`/meetings/${meeting.meeting_id}`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "MEETING_NOT_FOUND");
});
