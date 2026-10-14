import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// 앱의 경로 별칭을 같은 소스로 해석하고, react는 1회 렌더 shim으로 바꿔 훅을 실제로 실행한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react") return nextResolve(new URL("./reactHookShim.mjs", import.meta.url).href, context);
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

// apiFetch가 워크스페이스 ID를 읽는 localStorage만 흉내 낸다.
globalThis.window = { localStorage: { getItem: () => "ws_test", setItem() {}, removeItem() {} } };

const { render } = await import("./reactHookShim.mjs");
const {
  createPcmAssembler,
  createSpeechEventParser,
  describeSpeechPlaybackError,
  SPEECH_PLAYBACK_MESSAGES,
  SpeechStreamError
} = await import("../src/features/agent-chat/lib/speechPlayback.ts");
const { streamSpeechSynthesis } = await import("../src/features/agent-chat/api/speech.ts");
const { useSpeechPlayback } = await import("../src/features/agent-chat/model/useSpeechPlayback.ts");
const { ApiError, INSUFFICIENT_CREDIT_MESSAGE } = await import("../src/shared/lib/apiErrors.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");

const flush = () => new Promise((resolve) => setImmediate(resolve));

function pcmBase64(samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return buffer.toString("base64");
}

/** 줄 단위 문자열 조각을 그대로 흘려보내는 NDJSON 응답. */
function ndjsonResponse(chunks, init = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" }, ...init });
}

test("NDJSON 파서는 줄 중간에서 끊긴 조각을 이어 붙이고 모르는 이벤트·깨진 줄은 무시한다", () => {
  const parser = createSpeechEventParser();
  assert.deepEqual(parser.push('{"type":"audio","del'), []);
  assert.deepEqual(parser.push('ta":"AAAA"}\n{"type":"ping"}\nnot json\n'), [{ type: "audio", delta: "AAAA" }]);
  assert.deepEqual(parser.push('{"type":"error","code":"deadline_exceeded"}'), []);
  assert.deepEqual(parser.flush(), [{ type: "error", code: "deadline_exceeded" }]);
  assert.deepEqual(createSpeechEventParser().push('{"type":"done"}\r\n'), [{ type: "done" }]);
});

test("PCM 조각이 샘플(2바이트) 중간에서 갈리면 남는 바이트를 다음 조각 앞에 붙인다", () => {
  const assembler = createPcmAssembler();
  // 샘플 [32767, -32768, 16384] = 바이트 FF 7F 00 80 00 40 을 3바이트씩 자른다.
  const first = assembler.push(new Uint8Array([0xff, 0x7f, 0x00]));
  assert.deepEqual([...first].map((value) => Math.round(value * 32768)), [32767]);
  const second = assembler.push(new Uint8Array([0x80, 0x00, 0x40]));
  assert.deepEqual([...second].map((value) => Math.round(value * 32768)), [-32768, 16384]);
  assert.equal(assembler.push(new Uint8Array([0x01])).length, 0);
});

test("재생 실패 문구: 멈춤은 안내하지 않고, 402는 크레딧 부족, 스트림 코드는 한국어, 연결 실패는 재시도 안내", () => {
  assert.equal(describeSpeechPlaybackError(Object.assign(new Error("aborted"), { name: "AbortError" })), null);
  assert.equal(describeSpeechPlaybackError(new ApiError("크레딧이 부족해 작업을 시작하지 않았습니다.", 402, "INSUFFICIENT_CREDIT")), INSUFFICIENT_CREDIT_MESSAGE);
  assert.equal(describeSpeechPlaybackError(new ApiError("아직 완료되지 않은 답변입니다.", 409)), "아직 완료되지 않은 답변입니다.");
  assert.equal(describeSpeechPlaybackError(new SpeechStreamError("provider_rate_limited")), "요청이 많아 잠시 후 다시 시도해 주세요.");
  assert.equal(describeSpeechPlaybackError(new TypeError("fetch failed")), SPEECH_PLAYBACK_MESSAGES.network);
  assert.equal(describeSpeechPlaybackError("?"), SPEECH_PLAYBACK_MESSAGES.failed);
});

test("합성 요청은 message_id를 JSON으로 POST하고 audio 조각을 샘플로 넘긴 뒤 done에서 끝난다", async (t) => {
  saveAccessToken("test-access");
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/workspaces/ws_test/speech/synthesis");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("Authorization"), "Bearer test-access");
    assert.deepEqual(JSON.parse(init.body), { message_id: "msg_2" });
    return ndjsonResponse([
      `{"type":"audio","delta":"${pcmBase64([1000, -1000])}"}\n{"type":"au`,
      `dio","delta":"${pcmBase64([500])}"}\n{"type":"done"}\n`
    ]);
  });
  const received = [];
  await streamSpeechSynthesis("msg_2", { signal: new AbortController().signal, onAudio: (samples) => received.push([...samples]) });
  assert.deepEqual(received.map((samples) => samples.map((value) => Math.round(value * 32768))), [[1000, -1000], [500]]);
});

test("스트림 도중 error 이벤트는 코드를 담은 SpeechStreamError로, 종결 없이 끊기면 실패로 던진다", async (t) => {
  saveAccessToken("test-access");
  t.mock.method(globalThis, "fetch", async () => ndjsonResponse([`{"type":"audio","delta":"${pcmBase64([1])}"}\n{"type":"error","code":"provider_unavailable"}\n`]));
  await assert.rejects(streamSpeechSynthesis("msg_2", { signal: new AbortController().signal, onAudio() {} }), { name: "SpeechStreamError", code: "provider_unavailable" });

  t.mock.method(globalThis, "fetch", async () => ndjsonResponse([`{"type":"audio","delta":"${pcmBase64([1])}"}\n`]));
  await assert.rejects(streamSpeechSynthesis("msg_2", { signal: new AbortController().signal, onAudio() {} }), { message: SPEECH_PLAYBACK_MESSAGES.failed });
});

test("스트림 시작 전 HTTP 오류는 status·code를 보존한 ApiError로 던진다", async (t) => {
  saveAccessToken("test-access");
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { code: "INSUFFICIENT_CREDIT", message: "크레딧이 부족해 작업을 시작하지 않았습니다." } }, { status: 402 })
  );
  await assert.rejects(streamSpeechSynthesis("msg_2", { signal: new AbortController().signal, onAudio() {} }), { status: 402, code: "INSUFFICIENT_CREDIT" });
});

/** AudioContext 가짜. 만든 소스와 닫힘 여부를 기록하고, 소스는 finish()로 끝낼 수 있다. */
function installFakeAudio(t) {
  const contexts = [];
  class FakeSource {
    constructor(context) { this.context = context; this.started = null; this.stopped = false; this.onended = null; }
    connect() {}
    start(at) { this.started = at; }
    stop() { this.stopped = true; }
    finish() { this.onended?.(); }
  }
  class FakeAudioContext {
    constructor() { this.state = "running"; this.currentTime = 0; this.closed = false; this.sources = []; this.destination = {}; contexts.push(this); }
    createBuffer(channels, length, sampleRate) {
      assert.equal(sampleRate, 24_000);
      const data = new Float32Array(length);
      return { duration: length / sampleRate, getChannelData: () => data };
    }
    createBufferSource() { const source = new FakeSource(this); this.sources.push(source); return source; }
    async resume() {}
    async close() { this.closed = true; }
  }
  globalThis.AudioContext = FakeAudioContext;
  t.after(() => { delete globalThis.AudioContext; });
  return contexts;
}

/** fetch를 손으로 밀어 주는 NDJSON 스트림으로 바꾼다. abort되면 read가 AbortError로 끝난다. */
function installControlledStream(t) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    const encoder = new TextEncoder();
    const call = { aborted: false };
    const body = new ReadableStream({
      start(controller) {
        call.send = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        call.close = () => controller.close();
        init.signal.addEventListener("abort", () => {
          call.aborted = true;
          controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      }
    });
    calls.push(call);
    return new Response(body, { status: 200 });
  });
  return calls;
}

test("듣기를 누르면 로딩 → 첫 조각부터 재생이 되고 done 뒤 마지막 소스가 끝나면 멈춤 상태로 돌아간다", async (t) => {
  saveAccessToken("test-access");
  const contexts = installFakeAudio(t);
  const calls = installControlledStream(t);
  const hook = render(() => useSpeechPlayback("chat_1"));
  hook.result.toggle("msg_2");
  hook.rerender();
  assert.deepEqual(hook.result.playback, { messageId: "msg_2", status: "loading" });
  await flush();
  calls[0].send({ type: "audio", delta: pcmBase64([1, 2, 3]) });
  calls[0].send({ type: "audio", delta: pcmBase64([4]) });
  await flush();
  hook.rerender();
  assert.deepEqual(hook.result.playback, { messageId: "msg_2", status: "playing" });
  const [first, second] = contexts[0].sources;
  // 두 번째 조각은 첫 조각이 끝나는 시각에 이어 붙는다.
  assert.equal(second.started, first.started + 3 / 24_000);
  calls[0].send({ type: "done" });
  calls[0].close();
  await flush();
  hook.rerender();
  assert.deepEqual(hook.result.playback, { messageId: "msg_2", status: "playing" });
  first.finish();
  second.finish();
  hook.rerender();
  assert.equal(hook.result.playback, null);
  assert.equal(contexts[0].closed, true);
  assert.equal(hook.result.error, null);
});

test("재생 중 다시 누르면 요청을 끊고 소리를 멈추며, 다른 답변을 누르면 이전 재생을 끊고 새로 시작한다", async (t) => {
  saveAccessToken("test-access");
  const contexts = installFakeAudio(t);
  const calls = installControlledStream(t);
  const hook = render(() => useSpeechPlayback("chat_1"));
  hook.result.toggle("msg_2");
  await flush();
  calls[0].send({ type: "audio", delta: pcmBase64([1]) });
  await flush();
  hook.result.toggle("msg_4");
  await flush();
  hook.rerender();
  assert.equal(calls[0].aborted, true);
  assert.equal(contexts[0].sources[0].stopped, true);
  assert.equal(contexts[0].closed, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(hook.result.playback, { messageId: "msg_4", status: "loading" });

  hook.result.toggle("msg_4");
  await flush();
  hook.rerender();
  assert.equal(calls[1].aborted, true);
  assert.equal(hook.result.playback, null);
  // 사용자가 멈춘 것은 오류로 안내하지 않는다.
  assert.equal(hook.result.error, null);
});

test("세션이 바뀌거나 언마운트되면 진행 중인 재생과 요청을 끊는다", async (t) => {
  saveAccessToken("test-access");
  installFakeAudio(t);
  const calls = installControlledStream(t);
  let sessionId = "chat_1";
  const hook = render(() => useSpeechPlayback(sessionId));
  hook.result.toggle("msg_2");
  await flush();
  sessionId = "chat_2";
  hook.rerender();
  assert.equal(calls[0].aborted, true);
  // shim은 effect 안의 setState를 다음 렌더에 반영한다.
  hook.rerender();
  assert.equal(hook.result.playback, null);

  hook.result.toggle("msg_9");
  await flush();
  hook.unmount();
  assert.equal(calls[1].aborted, true);
});

test("패널이 숨겨지면(마운트 유지) 진행 중인 재생과 요청을 끊는다", async (t) => {
  saveAccessToken("test-access");
  const contexts = installFakeAudio(t);
  const calls = installControlledStream(t);
  let isVisible = true;
  const hook = render(() => useSpeechPlayback("chat_1", isVisible));
  hook.result.toggle("msg_2");
  await flush();
  calls[0].send({ type: "audio", delta: pcmBase64([1]) });
  await flush();
  isVisible = false;
  hook.rerender();
  assert.equal(calls[0].aborted, true);
  assert.equal(contexts[0].sources[0].stopped, true);
  assert.equal(contexts[0].closed, true);
  hook.rerender();
  assert.equal(hook.result.playback, null);
});

test("402·스트림 오류·연결 실패는 그 답변에 안내 문구를 붙이고 재생을 정리한다", async (t) => {
  saveAccessToken("test-access");
  const contexts = installFakeAudio(t);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { code: "INSUFFICIENT_CREDIT", message: "크레딧이 부족해 작업을 시작하지 않았습니다." } }, { status: 402 })
  );
  const hook = render(() => useSpeechPlayback("chat_1"));
  hook.result.toggle("msg_2");
  await flush();
  hook.rerender();
  assert.equal(hook.result.playback, null);
  assert.deepEqual(hook.result.error, { messageId: "msg_2", message: INSUFFICIENT_CREDIT_MESSAGE });
  assert.equal(contexts[0].closed, true);

  t.mock.method(globalThis, "fetch", async () => ndjsonResponse([`{"type":"audio","delta":"${pcmBase64([1])}"}\n{"type":"error","code":"deadline_exceeded"}\n`]));
  hook.result.toggle("msg_3");
  await flush();
  await flush();
  hook.rerender();
  assert.equal(hook.result.playback, null);
  assert.deepEqual(hook.result.error, { messageId: "msg_3", message: "음성 생성이 지연돼 중단했습니다." });
  assert.equal(contexts[1].sources[0].stopped, true);

  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
  hook.result.toggle("msg_4");
  await flush();
  hook.rerender();
  assert.deepEqual(hook.result.error, { messageId: "msg_4", message: SPEECH_PLAYBACK_MESSAGES.network });
});

test("AudioContext가 없는 브라우저는 요청 없이 미지원 안내만 한다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("요청하면 안 된다"));
  const hook = render(() => useSpeechPlayback("chat_1"));
  hook.result.toggle("msg_2");
  await flush();
  hook.rerender();
  assert.equal(hook.result.playback, null);
  assert.deepEqual(hook.result.error, { messageId: "msg_2", message: SPEECH_PLAYBACK_MESSAGES.unsupported });
});
