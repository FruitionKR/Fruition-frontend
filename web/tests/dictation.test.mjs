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
const { appendDictation, describeMicrophoneError, pickRecordingMimeType, DICTATION_MESSAGES, DICTATION_MAX_MS } = await import("../src/features/agent-chat/lib/dictation.ts");
const { transcribeSpeech } = await import("../src/features/agent-chat/api/speech.ts");
const { useDictation } = await import("../src/features/agent-chat/model/useDictation.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("녹음 형식은 서버가 받는 순서대로 브라우저가 지원하는 첫 형식을 고른다", () => {
  assert.equal(pickRecordingMimeType((type) => type.startsWith("audio/webm")), "audio/webm;codecs=opus");
  assert.equal(pickRecordingMimeType((type) => type === "audio/mp4"), "audio/mp4");
  assert.equal(pickRecordingMimeType(() => false), null);
});

test("마이크 오류는 권한 거부·마이크 없음·그 밖으로 안내한다", () => {
  const named = (name) => Object.assign(new Error(name), { name });
  assert.equal(describeMicrophoneError(named("NotAllowedError")), DICTATION_MESSAGES.permissionDenied);
  assert.equal(describeMicrophoneError(named("NotFoundError")), DICTATION_MESSAGES.noMicrophone);
  assert.equal(describeMicrophoneError(new Error("boom")), DICTATION_MESSAGES.microphoneFailed);
});

test("받아쓴 텍스트는 입력창 내용 뒤에 띄어 붙이고 빈 결과는 바꾸지 않는다", () => {
  assert.equal(appendDictation("", " 안녕 "), "안녕");
  assert.equal(appendDictation("질문:", "검색은 어떻게"), "질문: 검색은 어떻게");
  assert.equal(appendDictation("질문:\n", "검색"), "질문:\n검색");
  assert.equal(appendDictation("그대로", "   "), "그대로");
});

test("전사 요청은 오디오 bytes를 Content-Type 그대로 POST하고 text를 돌려준다", async (t) => {
  saveAccessToken("test-access");
  const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" });
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/workspaces/ws_test/speech/transcriptions");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("Content-Type"), "audio/webm;codecs=opus");
    assert.equal(init.headers.get("Authorization"), "Bearer test-access");
    assert.equal(init.body, audio);
    return Response.json({ text: "검색 인덱싱은 어떻게 동작하나요?" });
  });
  assert.equal(await transcribeSpeech(audio), "검색 인덱싱은 어떻게 동작하나요?");
});

test("402 등 실패 응답은 서버 문구를 그대로 던진다", async (t) => {
  saveAccessToken("test-access");
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { code: "PAYMENT_REQUIRED", message: "이번 달 AI 사용량을 모두 썼습니다." } }, { status: 402 })
  );
  await assert.rejects(transcribeSpeech(new Blob([new Uint8Array(1)], { type: "audio/webm" })), { message: "이번 달 AI 사용량을 모두 썼습니다.", status: 402 });
});

/** MediaRecorder·getUserMedia 가짜. stop()은 dataavailable → stop 이벤트를 순서대로 낸다. */
function installFakeMedia(t, { chunk = new Uint8Array([9, 9]), getUserMedia } = {}) {
  const tracks = [{ stopped: 0, stop() { this.stopped += 1; } }];
  const stream = { getTracks: () => tracks };
  const recorders = [];
  class FakeRecorder extends EventTarget {
    static isTypeSupported(type) { return type === "audio/webm;codecs=opus"; }
    constructor(mediaStream, options) {
      super();
      this.options = options;
      this.state = "inactive";
      assert.equal(mediaStream, stream);
      recorders.push(this);
    }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob([chunk], { type: this.options.mimeType }) }));
      this.dispatchEvent(new Event("stop"));
    }
  }
  // Node의 globalThis.navigator는 getter라 defineProperty로 덮어쓴다.
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.MediaRecorder = FakeRecorder;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: getUserMedia ?? (async () => stream) } }
  });
  t.after(() => {
    delete globalThis.MediaRecorder;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  });
  return { tracks, recorders };
}

test("녹음을 멈추면 전사 결과를 입력창 콜백으로 넘기고 마이크 트랙을 닫는다", async (t) => {
  saveAccessToken("test-access");
  const { tracks, recorders } = installFakeMedia(t);
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    assert.equal(init.headers.get("Content-Type"), "audio/webm;codecs=opus");
    return Response.json({ text: "안녕하세요" });
  });
  const received = [];
  const hook = render(() => useDictation((text) => received.push(text)));
  await hook.result.start();
  hook.rerender();
  assert.equal(hook.result.status, "recording");
  assert.equal(hook.result.message, DICTATION_MESSAGES.recording);
  assert.equal(recorders[0].state, "recording");

  hook.result.stop();
  hook.rerender();
  assert.equal(hook.result.status, "transcribing");
  assert.equal(tracks[0].stopped, 1);
  await flush();
  hook.rerender();
  assert.deepEqual(received, ["안녕하세요"]);
  assert.equal(hook.result.status, "idle");
  assert.equal(hook.result.message, null);
});

test("무음이면 입력창을 건드리지 않고 인식된 음성이 없다고 안내한다", async (t) => {
  saveAccessToken("test-access");
  installFakeMedia(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ text: "" }));
  const received = [];
  const hook = render(() => useDictation((text) => received.push(text)));
  await hook.result.start();
  hook.result.stop();
  await flush();
  hook.rerender();
  assert.deepEqual(received, []);
  assert.equal(hook.result.status, "idle");
  assert.equal(hook.result.message, DICTATION_MESSAGES.empty);
});

test("마이크 권한이 거부되면 녹음을 시작하지 않고 안내한다", async (t) => {
  installFakeMedia(t, { getUserMedia: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); } });
  const hook = render(() => useDictation(() => assert.fail("전사되면 안 된다")));
  await hook.result.start();
  hook.rerender();
  assert.equal(hook.result.status, "idle");
  assert.equal(hook.result.message, DICTATION_MESSAGES.permissionDenied);
});

test("MediaRecorder가 없는 브라우저는 미지원 안내만 한다", async () => {
  const hook = render(() => useDictation(() => assert.fail("전사되면 안 된다")));
  await hook.result.start();
  hook.rerender();
  assert.equal(hook.result.message, DICTATION_MESSAGES.unsupported);
});

test("60초가 지나면 자동으로 녹음을 멈춘다", async (t) => {
  saveAccessToken("test-access");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { recorders } = installFakeMedia(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ text: "자동 종료" }));
  const received = [];
  const hook = render(() => useDictation((text) => received.push(text)));
  await hook.result.start();
  assert.equal(recorders[0].state, "recording");
  t.mock.timers.tick(DICTATION_MAX_MS);
  assert.equal(recorders[0].state, "inactive");
  await flush();
  assert.deepEqual(received, ["자동 종료"]);
});
