import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// 앱의 경로 별칭과 확장자 없는 상대 import를 같은 소스(.ts)로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const { buildLiveSocketUrl, describeLiveError, isFatalLiveError, parseLiveServerEvent, LIVE_CLOSE_IN_USE } = await import("../src/features/meeting-dictation/lib/liveProtocol.ts");
const { applyLiveEvent, EMPTY_TRANSCRIPT, hasFinalSegments, transcriptLines } = await import("../src/features/meeting-dictation/lib/liveTranscript.ts");
const { createResampler, encodePcm16, pcmDurationMs, shouldCommit, splitAudioFrames, COMMIT_MAX_MS, COMMIT_MIN_MS } = await import("../src/features/meeting-dictation/lib/pcm16.ts");
const { describeNotesRequestError, describeNotesSaveError, isCapturingPhase, meetingProgressText, MEETING_MESSAGES } = await import("../src/features/meeting-dictation/lib/meetingNotesFlow.ts");
const { createLiveSession } = await import("../src/features/meeting-dictation/model/liveSession.ts");
const { ApiError } = await import("../src/shared/lib/apiErrors.ts");

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("서버 이벤트를 계약대로 읽고 모르는 type·깨진 JSON·바이너리는 무시한다", () => {
  assert.deepEqual(parseLiveServerEvent('{"type":"ready","sample_rate":24000,"stream_order":2}'), { type: "ready", sample_rate: 24000, stream_order: 2 });
  assert.deepEqual(
    parseLiveServerEvent('{"type":"committed","segment_id":"s1_a","previous_segment_id":null,"position":3}'),
    { type: "committed", segment_id: "s1_a", previous_segment_id: null, position: 3 }
  );
  assert.deepEqual(parseLiveServerEvent('{"type":"delta","segment_id":"s1_a","text":"안녕"}'), { type: "delta", segment_id: "s1_a", text: "안녕" });
  assert.deepEqual(parseLiveServerEvent('{"type":"finished","segment_count":4}'), { type: "finished", segment_count: 4 });
  assert.deepEqual(parseLiveServerEvent('{"type":"error","code":"transcript_limit","message":"x"}'), { type: "error", code: "transcript_limit", message: "x" });
  assert.equal(parseLiveServerEvent('{"type":"committed","segment_id":"s1_a"}'), null);
  assert.equal(parseLiveServerEvent('{"type":"unknown"}'), null);
  assert.equal(parseLiveServerEvent("not json"), null);
  assert.equal(parseLiveServerEvent(new ArrayBuffer(2)), null);
});

test("크레딧·10만 자 한도·회의 상태·다른 곳 사용 중은 다시 연결하지 않고 안내한다", () => {
  for (const code of ["insufficient_credit", "transcript_limit", "meeting_not_open", "live_in_use"]) assert.equal(isFatalLiveError(code), true, code);
  for (const code of ["transcription_failed", "backpressure", "transcript_save_failed"]) assert.equal(isFatalLiveError(code), false, code);
  assert.match(describeLiveError("transcript_limit"), /10만 자/);
  assert.match(describeLiveError("insufficient_credit"), /크레딧이 부족합니다/);
  assert.equal(describeLiveError("모르는_코드"), describeLiveError("transcription_failed"));
});

test("WebSocket 주소는 문서 API 오리진이 있으면 그쪽 wss, 없으면 화면 오리진으로 붙고 ticket을 인코딩한다", () => {
  assert.equal(buildLiveSocketUrl("https://api.example.com", "https://app.example.com", "mtg_1", "wst a+b"), "wss://api.example.com/api/meetings/mtg_1/live?ticket=wst%20a%2Bb");
  assert.equal(buildLiveSocketUrl(null, "http://localhost:3000", "mtg_1", "wst_1"), "ws://localhost:3000/api/meetings/mtg_1/live?ticket=wst_1");
});

test("전사: delta가 committed보다 먼저 와도 마지막 줄에 임시로 두었다가 position 순서로 자리 잡는다", () => {
  let transcript = EMPTY_TRANSCRIPT;
  transcript = applyLiveEvent(transcript, { type: "delta", segment_id: "b", text: "둘째 " });
  transcript = applyLiveEvent(transcript, { type: "committed", segment_id: "a", previous_segment_id: null, position: 1 });
  transcript = applyLiveEvent(transcript, { type: "delta", segment_id: "a", text: "첫째" });
  assert.deepEqual(transcriptLines(transcript), ["첫째", "둘째"]);
  assert.equal(hasFinalSegments(transcript), false);
  // 확정 문장은 도착 순서와 상관없이 position 자리에 들어가고 임시 글을 바꾼다.
  transcript = applyLiveEvent(transcript, { type: "committed", segment_id: "b", previous_segment_id: "a", position: 2 });
  transcript = applyLiveEvent(transcript, { type: "completed", segment_id: "b", text: "둘째 문장입니다." });
  transcript = applyLiveEvent(transcript, { type: "delta", segment_id: "b", text: "늦은 조각" });
  assert.deepEqual(transcriptLines(transcript), ["첫째", "둘째 문장입니다."]);
  assert.equal(hasFinalSegments(transcript), true);
  // 원래 상태는 바뀌지 않는다.
  assert.deepEqual(transcriptLines(EMPTY_TRANSCRIPT), []);
});

test("48kHz 마이크 샘플을 24kHz로 줄이고 조각 경계에서도 샘플 수가 이어진다", () => {
  const resample = createResampler(48_000);
  const ramp = Float32Array.from({ length: 4096 }, (_, index) => index / 4096);
  const first = resample(ramp.subarray(0, 1000));
  const second = resample(ramp.subarray(1000));
  assert.equal(first.length + second.length, 2048);
  const joined = [...first, ...second];
  // 선형 신호를 2:1로 줄이면 짝수 번째 샘플과 같다(경계에서 튀지 않는다).
  joined.forEach((value, index) => assert.ok(Math.abs(value - ramp[index * 2]) < 1e-6, `index ${index}`));
  // 44.1kHz처럼 나누어떨어지지 않는 rate도 길이가 비율대로 나온다.
  const resample44 = createResampler(44_100);
  let total = 0;
  for (let index = 0; index < 10; index += 1) total += resample44(new Float32Array(4410)).length;
  assert.ok(Math.abs(total - 24_000) <= 1, `total ${total}`);
});

test("PCM16은 little-endian으로 쓰고 범위를 넘는 값은 자르며 frame은 48,000 bytes 이하 짝수로 자른다", () => {
  const bytes = encodePcm16(Float32Array.from([0, 1, -1, 2, -2, 0.5]));
  const view = new DataView(bytes.buffer);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((index) => view.getInt16(index * 2, true)), [0, 32767, -32768, 32767, -32768, 16383]);
  const frames = splitAudioFrames(new Uint8Array(100_001 - 1));
  assert.deepEqual(frames.map((frame) => frame.length), [48_000, 48_000, 4_000]);
  assert.equal(pcmDurationMs(48_000), 1000);
});

test("commit은 2초 이후 말이 쉬는 곳에서, 늦어도 15초마다 보낸다", () => {
  assert.equal(shouldCommit(COMMIT_MIN_MS - 1, 0), false);
  assert.equal(shouldCommit(COMMIT_MIN_MS, 0.001), true);
  assert.equal(shouldCommit(COMMIT_MIN_MS, 0.2), false);
  assert.equal(shouldCommit(COMMIT_MAX_MS, 0.2), true);
});

/** 브라우저 WebSocket 흉내. 보낸 메시지를 sent에 쌓고 서버 쪽 동작은 테스트가 직접 일으킨다. */
function createFakeSocket() {
  const listeners = { message: [], close: [] };
  const socket = {
    readyState: 1,
    binaryType: "blob",
    sent: [],
    closedWith: null,
    send(data) { socket.sent.push(data); },
    close(code) {
      socket.closedWith = code;
      socket.serverClose(code);
    },
    addEventListener(type, listener) { listeners[type].push(listener); },
    serverSend(event) { for (const listener of listeners.message) listener({ data: JSON.stringify(event) }); },
    serverClose(code) {
      socket.readyState = 3;
      for (const listener of listeners.close.splice(0)) listener({ code });
    },
    texts: () => socket.sent.filter((item) => typeof item === "string").map((item) => JSON.parse(item).type),
    audioBytes: () => socket.sent.filter((item) => typeof item !== "string").reduce((sum, item) => sum + item.length, 0)
  };
  return socket;
}

/** t.after로 세션을 정리한다. ready 뒤 55분 rollover 타이머가 남아 테스트가 끝나지 않는 것을 막는다. */
function startSession(t, overrides = {}) {
  const sockets = [];
  const tickets = [];
  const calls = { ready: 0, reconnecting: 0, events: [], stopped: [] };
  const session = createLiveSession({
    issueTicket: async () => {
      tickets.push(`wst_${tickets.length + 1}`);
      return tickets.at(-1);
    },
    openSocket: async () => {
      const socket = createFakeSocket();
      sockets.push(socket);
      return socket;
    },
    onReady: () => { calls.ready += 1; },
    onTranscriptEvent: (event) => calls.events.push(event),
    onReconnecting: () => { calls.reconnecting += 1; },
    onStopped: (result) => calls.stopped.push(result),
    reconnectDelayMs: 0,
    ...overrides
  });
  t.after(() => session.dispose());
  return { session, sockets, tickets, calls };
}

const second = () => new Uint8Array(48_000);

test("ready 전에 받은 음성은 모아 두었다가 ready 직후 보내고, 말이 쉬면 commit한다", async (t) => {
  const { session, sockets, calls } = startSession(t);
  await session.start();
  session.sendAudio(second(), 0.3);
  assert.equal(sockets[0].sent.length, 0);
  sockets[0].serverSend({ type: "ready", sample_rate: 24000, stream_order: 1 });
  assert.equal(calls.ready, 1);
  assert.equal(sockets[0].audioBytes(), 48_000);
  assert.equal(sockets[0].binaryType, "arraybuffer");
  session.sendAudio(second(), 0.001);
  assert.deepEqual(sockets[0].texts(), ["commit"]);
  sockets[0].serverSend({ type: "completed", segment_id: "s1_a", text: "안녕하세요" });
  assert.deepEqual(calls.events, [{ type: "completed", segment_id: "s1_a", text: "안녕하세요" }]);
});

test("멈추면 finish를 보내고 서버가 finished 뒤 닫을 때 정상 종료를 알린다", async (t) => {
  const { session, sockets, calls } = startSession(t);
  await session.start();
  sockets[0].serverSend({ type: "ready", sample_rate: 24000, stream_order: 1 });
  session.finish();
  assert.deepEqual(sockets[0].texts(), ["finish"]);
  // finish 뒤 음성은 보내지 않는다.
  session.sendAudio(second(), 0.3);
  assert.equal(sockets[0].audioBytes(), 0);
  sockets[0].serverSend({ type: "finished", segment_count: 0 });
  sockets[0].serverClose(1000);
  assert.deepEqual(calls.stopped, [{ ok: true }]);
});

test("예기치 않게 끊기면 새 ticket으로 다시 연결하고 그동안의 음성을 이어 보낸다", async (t) => {
  const { session, sockets, tickets, calls } = startSession(t);
  await session.start();
  sockets[0].serverSend({ type: "ready", sample_rate: 24000, stream_order: 1 });
  sockets[0].serverSend({ type: "error", code: "transcription_failed", message: "" });
  sockets[0].serverClose(1011);
  assert.equal(calls.reconnecting, 1);
  session.sendAudio(second(), 0.3);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(sockets.length, 2);
  assert.deepEqual(tickets, ["wst_1", "wst_2"]);
  sockets[1].serverSend({ type: "ready", sample_rate: 24000, stream_order: 2 });
  assert.equal(sockets[1].audioBytes(), 48_000);
  assert.equal(calls.ready, 2);
  assert.deepEqual(calls.stopped, []);
});

test("크레딧 부족·10만 자 한도 오류는 다시 연결하지 않고 그 안내로 끝낸다", async (t) => {
  for (const code of ["insufficient_credit", "transcript_limit"]) {
    const { session, sockets, calls } = startSession(t);
    await session.start();
    sockets[0].serverSend({ type: "ready", sample_rate: 24000, stream_order: 1 });
    sockets[0].serverSend({ type: "error", code, message: "" });
    sockets[0].serverClose(1008);
    assert.equal(calls.reconnecting, 0, code);
    assert.deepEqual(calls.stopped, [{ ok: false, code, message: describeLiveError(code) }]);
  }
});

test("같은 회의를 다른 곳에서 받아쓰는 중이면(close 4409) 다시 연결하지 않는다", async (t) => {
  const { session, sockets, calls } = startSession(t);
  await session.start();
  sockets[0].serverClose(LIVE_CLOSE_IN_USE);
  assert.equal(calls.reconnecting, 0);
  assert.equal(calls.stopped[0].code, "live_in_use");
});

test("재연결을 다 써도 붙지 않으면 저장된 내용은 남아 있다고 안내하고 끝낸다", async (t) => {
  const { session, sockets, calls } = startSession(t, { maxReconnects: 1 });
  await session.start();
  sockets[0].serverClose(1006);
  await new Promise((resolve) => setTimeout(resolve, 5));
  sockets[1].serverClose(1006);
  assert.equal(calls.stopped.length, 1);
  assert.equal(calls.stopped[0].ok, false);
  assert.equal(calls.stopped[0].message, describeLiveError("disconnected"));
});

test("ticket 발급이 409 MEETING_LIVE_IN_USE면 다시 시도하지 않고 서버 문구로 끝낸다", async (t) => {
  const { session, calls } = startSession(t, {
    issueTicket: async () => { throw new ApiError("이미 다른 곳에서 받아쓰고 있습니다.", 409, "MEETING_LIVE_IN_USE"); }
  });
  await session.start();
  assert.deepEqual(calls.stopped, [{ ok: false, code: "live_in_use", message: "이미 다른 곳에서 받아쓰고 있습니다." }]);
});

test("연결 전에 멈추면 모아 둔 음성 없이 바로 끝낸다", async (t) => {
  const { session, calls } = startSession(t, { issueTicket: () => new Promise(() => {}) });
  void session.start();
  session.finish();
  await flush();
  assert.deepEqual(calls.stopped, [{ ok: true }]);
});

test("회의록 요청 오류: 누락 전사는 저장된 내용으로 다시 만들 수 있고, 연결이 덜 닫혔으면 다시 보낸다", () => {
  assert.deepEqual(describeNotesRequestError(new ApiError("x", 409, "MEETING_TRANSCRIPT_INCOMPLETE")), { message: MEETING_MESSAGES.incompleteTranscript, incomplete: true, liveStillOpen: false });
  assert.equal(describeNotesRequestError(new ApiError("x", 409, "MEETING_LIVE_IN_USE")).liveStillOpen, true);
  assert.equal(describeNotesRequestError(new ApiError("x", 422, "MEETING_TRANSCRIPT_EMPTY")).message, MEETING_MESSAGES.emptyTranscript);
  assert.match(describeNotesRequestError(new ApiError("x", 409, "MEETING_NOTES_BUSY")).message, /워크스페이스/);
  assert.equal(describeNotesRequestError(new ApiError("x", 402, "INSUFFICIENT_CREDIT")).message, "크레딧이 부족합니다.");
  assert.equal(describeNotesSaveError(new ApiError("x", 409, "DOCUMENT_REVISION_CHANGED"), "f"), MEETING_MESSAGES.revisionChanged);
  assert.equal(describeNotesSaveError(new ApiError("서버 문구", 403, "DOCUMENT_WRITE_FORBIDDEN"), "f"), "서버 문구");
});

test("진행 표시는 받아쓰기·마무리·회의록 작성 중에만 보이고, 회의록 작성 중 문구는 시안과 같다", () => {
  assert.equal(meetingProgressText("generating"), "답변을 작성하고 있어요…");
  assert.equal(meetingProgressText("ready"), null);
  assert.equal(meetingProgressText("stopped"), null);
  assert.equal(isCapturingPhase("reconnecting"), true);
  assert.equal(isCapturingPhase("finishing"), false);
});
