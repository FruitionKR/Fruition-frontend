import assert from "node:assert/strict";
import test from "node:test";
import { createRouter, issueAccessToken, listen } from "../mock/lib/http.mjs";
import { state } from "../mock/state.mjs";
import { registerMeetingRoutes } from "../mock/routes/meetings.mjs";

/** mock 회의 녹음 라우트(#148)가 document meetings.md "녹음 원본과 회의 삭제" 계약대로 동작하는지 확인한다. */
async function startMock(t, env = {}) {
  const defaults = { MOCK_MEETING_PART_SIZE: "4", MOCK_MEETING_TRANSCRIBE_MS: "0", ...env };
  for (const [key, value] of Object.entries(defaults)) process.env[key] = value;
  t.after(() => {
    for (const key of Object.keys(defaults)) delete process.env[key];
  });
  const suffix = Math.random().toString(36).slice(2, 8);
  const userId = `user_rec_${suffix}`;
  const workspaceId = `ws_rec_${suffix}`;
  state.users.push({ id: userId });
  state.workspaces.push({ id: workspaceId, name: "recording" });
  state.members.push({ workspace_id: workspaceId, user_id: userId, role: "OWNER" });
  const router = createRouter(state);
  registerMeetingRoutes(router);
  const server = await listen(router, 0);
  t.mock.method(console, "log", () => {});
  t.after(() => server.close());
  const origin = `http://localhost:${server.address().port}`;
  const token = issueAccessToken(state, userId);
  const api = (path, init = {}) => fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers }
  });
  const post = (path, body) => api(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  return { origin, api, post };
}

async function createUploadMeeting(api) {
  const response = await api("/meetings", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ source: "upload", display_name: "녹음 회의" })
  });
  assert.equal(response.status, 201);
  return response.json();
}

/** start → parts → 조각 PUT(인증 없이 URL로) → complete. complete 응답을 돌려준다. */
async function uploadRecording({ origin, post }, meetingId, bytes, contentType = "audio/mp4") {
  const base = `/meetings/${meetingId}/recording/uploads`;
  const started = await post(base, { content_type: contentType, size: bytes.length });
  assert.equal(started.status, 200);
  const { ticket, part_size: partSize, part_count: partCount } = await started.json();
  assert.equal(partCount, Math.ceil(bytes.length / partSize));
  const { parts } = await (await post(`${base}/parts`, { ticket, first_part: 1, count: partCount })).json();
  assert.deepEqual(parts.map((part) => part.part_number), Array.from({ length: partCount }, (_, index) => index + 1));
  for (const part of parts) {
    const start = (part.part_number - 1) * partSize;
    const put = await fetch(`${origin}${part.url}`, { method: "PUT", body: bytes.subarray(start, start + partSize) });
    assert.equal(put.status, 200);
  }
  return post(`${base}/complete`, { ticket });
}

const waitFor = async (check) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("기다리던 상태가 오지 않았다");
};

test("녹음 파일 회의는 조각을 올려 확정하면 202 transcribing이 되고 전사가 끝나면 open·구간·has_recording을 돌려준다", async (t) => {
  const mock = await startMock(t);
  const meeting = await createUploadMeeting(mock.api);
  assert.equal(meeting.status, "awaiting_upload");
  assert.equal(meeting.has_recording, false);
  const completed = await uploadRecording(mock, meeting.meeting_id, Buffer.from("0123456789"));
  assert.equal(completed.status, 202);
  const body = await completed.json();
  assert.equal(body.status, "transcribing");
  assert.equal(body.has_recording, true);

  const done = await waitFor(async () => {
    const latest = await (await mock.api(`/meetings/${meeting.meeting_id}`)).json();
    return latest.status === "open" ? latest : null;
  });
  assert.equal(done.transcript_complete, true);
  assert.ok(done.segments.length > 0 && done.segments.every((segment) => segment.status === "completed" && segment.id.startsWith("s1_seg_")));
  assert.equal(done.error, null);
});

test("재생 주소는 올린 바이트를 형식대로 돌려주고 Range를 받으며, 만료되면 403이다", async (t) => {
  const mock = await startMock(t, { MOCK_MEETING_RECORDING_URL_TTL_MS: "200" });
  const meeting = await createUploadMeeting(mock.api);
  const missing = await mock.api(`/meetings/${meeting.meeting_id}/recording-url`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "MEETING_RECORDING_NOT_FOUND");

  await uploadRecording(mock, meeting.meeting_id, Buffer.from("abcdefghij"), "audio/x-m4a");
  const { url, expires_at: expiresAt } = await (await mock.api(`/meetings/${meeting.meeting_id}/recording-url`)).json();
  assert.ok(Date.parse(expiresAt) > Date.now());
  const full = await fetch(`${mock.origin}${url}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/mp4");
  assert.equal(await full.text(), "abcdefghij");
  const ranged = await fetch(`${mock.origin}${url}`, { headers: { Range: "bytes=2-4" } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(await ranged.text(), "cde");

  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal((await fetch(`${mock.origin}${url}`)).status, 403);
});

test("전사 중에는 삭제가 409 MEETING_TRANSCRIBING이고, 취소하면 failed·error 문구가 되어 다시 올리거나 삭제할 수 있다", async (t) => {
  const mock = await startMock(t, { MOCK_MEETING_TRANSCRIBE_MS: "60000" });
  const meeting = await createUploadMeeting(mock.api);
  await uploadRecording(mock, meeting.meeting_id, Buffer.from("12345"));
  const blocked = await mock.api(`/meetings/${meeting.meeting_id}`, { method: "DELETE" });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error.code, "MEETING_TRANSCRIBING");

  const cancelled = await mock.post(`/meetings/${meeting.meeting_id}/transcription/cancel`);
  assert.equal(cancelled.status, 200);
  const failed = await cancelled.json();
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /전사를 취소했습니다/);
  const again = await mock.post(`/meetings/${meeting.meeting_id}/transcription/cancel`);
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error.code, "MEETING_NOT_TRANSCRIBING");

  // failed에서는 다시 올릴 수 있다.
  assert.equal((await uploadRecording(mock, meeting.meeting_id, Buffer.from("67890"))).status, 202);
  await mock.post(`/meetings/${meeting.meeting_id}/transcription/cancel`);
  const deleted = await mock.api(`/meetings/${meeting.meeting_id}`, { method: "DELETE" });
  assert.equal(deleted.status, 204);
  assert.equal((await mock.api(`/meetings/${meeting.meeting_id}`)).status, 404);
});

test("형식·크기·크레딧·조각 크기가 맞지 않으면 계약의 code로 거절한다", async (t) => {
  const mock = await startMock(t);
  const meeting = await createUploadMeeting(mock.api);
  const base = `/meetings/${meeting.meeting_id}/recording/uploads`;
  const reject = async (body, status, code) => {
    const response = await mock.post(base, body);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  };
  await reject({ content_type: "video/mp4", size: 10 }, 415, "MEETING_RECORDING_UNSUPPORTED");
  await reject({ content_type: "audio/wav", size: 0 }, 422, "MEETING_RECORDING_EMPTY");
  await reject({ content_type: "audio/wav", size: 500 * 1024 * 1024 + 1 }, 413, "MEETING_RECORDING_TOO_LARGE");
  // MediaRecorder처럼 파라미터가 붙은 형식은 받는다.
  assert.equal((await mock.post(base, { content_type: "audio/webm;codecs=opus", size: 10 })).status, 200);

  process.env.MOCK_INSUFFICIENT_CREDIT = "1";
  t.after(() => delete process.env.MOCK_INSUFFICIENT_CREDIT);
  await reject({ content_type: "audio/wav", size: 10 }, 402, "INSUFFICIENT_CREDIT");
  delete process.env.MOCK_INSUFFICIENT_CREDIT;

  // 알린 크기보다 덜 올리면 확정이 400 MEETING_RECORDING_SIZE_MISMATCH다.
  const { ticket } = await (await mock.post(base, { content_type: "audio/wav", size: 8 })).json();
  const { parts } = await (await mock.post(`${base}/parts`, { ticket, first_part: 1, count: 2 })).json();
  await fetch(`${mock.origin}${parts[0].url}`, { method: "PUT", body: "abcd" });
  await fetch(`${mock.origin}${parts[1].url}`, { method: "PUT", body: "ef" });
  const mismatch = await mock.post(`${base}/complete`, { ticket });
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).error.code, "MEETING_RECORDING_SIZE_MISMATCH");
  // 버린 ticket은 다시 쓸 수 없다.
  const stale = await mock.post(`${base}/parts`, { ticket, first_part: 1, count: 1 });
  assert.equal(stale.status, 400);
  assert.equal((await stale.json()).error.code, "MEETING_UPLOAD_REJECTED");
});

test("전사가 실패하면 failed와 error 문구를 돌려준다", async (t) => {
  const mock = await startMock(t, { MOCK_MEETING_TRANSCRIPTION_ERROR: "녹음이 3시간을 넘어 전사할 수 없습니다. 나눠서 올려 주세요." });
  const meeting = await createUploadMeeting(mock.api);
  await uploadRecording(mock, meeting.meeting_id, Buffer.from("123"));
  const failed = await waitFor(async () => {
    const latest = await (await mock.api(`/meetings/${meeting.meeting_id}`)).json();
    return latest.status === "failed" ? latest : null;
  });
  assert.match(failed.error, /3시간/);
});
