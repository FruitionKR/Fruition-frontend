import assert from "node:assert/strict";
import test from "node:test";
import { createRouter, issueAccessToken, listen } from "../mock/lib/http.mjs";
import { state } from "../mock/state.mjs";
import { registerSpeechRoutes, speechText } from "../mock/routes/speech.mjs";

/** mock 답변 듣기 라우트(#149)가 document 계약대로 NDJSON PCM 스트림과 사전 오류를 돌려주는지 확인한다. */
async function startMock(t) {
  state.users.push({ id: "user_tts" });
  state.workspaces.push({ id: "ws_tts", name: "tts" });
  state.members.push({ workspace_id: "ws_tts", user_id: "user_tts", role: "OWNER" });
  state.chatSessions.push({ id: "chat_tts", workspace_id: "ws_tts", title: null, created_at: "", last_message_at: "" });
  state.chatMessages.push(
    { id: "msg_tts_done", session_id: "chat_tts", role: "assistant", status: "completed", content: "안녕하세요 [1]. `code` 입니다.", references: [] },
    { id: "msg_tts_pending", session_id: "chat_tts", role: "assistant", status: "pending", content: "...", references: [] },
    { id: "msg_tts_user", session_id: "chat_tts", role: "user", status: "completed", content: "질문", references: [] },
    { id: "msg_tts_code", session_id: "chat_tts", role: "assistant", status: "completed", content: "```js\nconsole.log(1)\n```", references: [] }
  );
  const router = createRouter(state);
  registerSpeechRoutes(router);
  const server = await listen(router, 0);
  const token = issueAccessToken(state, "user_tts");
  t.mock.method(console, "log", () => {});
  t.after(() => server.close());
  const port = server.address().port;
  return (messageId, init = {}) => fetch(`http://localhost:${port}/api/workspaces/ws_tts/speech/synthesis`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message_id: messageId }),
    ...init
  });
}

test("읽을 글 정리는 코드·인용 번호·기호를 걷어 낸다", () => {
  assert.equal(speechText("안녕하세요 [1]. `code` **굵게** 입니다.\n```js\nx\n```"), "안녕하세요 . 굵게 입니다.");
  assert.equal(speechText("```js\nconsole.log(1)\n```"), "");
});

test("완료된 답변은 audio 조각(홀수 바이트)들 뒤에 done 한 번으로 끝나는 NDJSON PCM 스트림이다", async (t) => {
  process.env.MOCK_SPEECH_CHUNK_DELAY_MS = "0";
  t.after(() => { delete process.env.MOCK_SPEECH_CHUNK_DELAY_MS; });
  const request = await startMock(t);
  const response = await request("msg_tts_done");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-ndjson");
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(events.length >= 2);
  assert.deepEqual(events.at(-1), { type: "done" });
  const audio = events.slice(0, -1);
  assert.ok(audio.every((event) => event.type === "audio" && typeof event.delta === "string"));
  // 첫 조각은 홀수 바이트라 샘플 경계와 어긋난다. 전체 길이는 짝수(16비트 샘플)다.
  assert.equal(Buffer.from(audio[0].delta, "base64").length % 2, 1);
  const total = audio.reduce((sum, event) => sum + Buffer.from(event.delta, "base64").length, 0);
  assert.equal(total % 2, 0);
});

test("스트림 시작 전 오류: 남의·없는·user 메시지는 404, 미완료는 409, 읽을 글이 없으면 422, 크레딧 부족이면 402", async (t) => {
  const request = await startMock(t);
  assert.equal((await request("msg_none")).status, 404);
  assert.equal((await request("msg_tts_user")).status, 404);
  assert.equal((await request("msg_tts_pending")).status, 409);
  assert.equal((await request("msg_tts_code")).status, 422);
  process.env.MOCK_INSUFFICIENT_CREDIT = "1";
  t.after(() => { delete process.env.MOCK_INSUFFICIENT_CREDIT; });
  const rejected = await request("msg_tts_done");
  assert.equal(rejected.status, 402);
  assert.equal((await rejected.json()).error.code, "INSUFFICIENT_CREDIT");
});

test("MOCK_SPEECH_ERROR를 두면 첫 조각 뒤에 error 이벤트로 끝난다", async (t) => {
  process.env.MOCK_SPEECH_ERROR = "provider_unavailable";
  t.after(() => { delete process.env.MOCK_SPEECH_ERROR; });
  const request = await startMock(t);
  const events = (await (await request("msg_tts_done")).text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events[0].type, "audio");
  assert.deepEqual(events.at(-1), { type: "error", code: "provider_unavailable" });
});
