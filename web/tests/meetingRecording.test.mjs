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

const { checkRecordingFile, meetingNameFromFile, MEETING_RECORDING_MAX_BYTES, MEETING_RECORDING_FILE_MESSAGES } = await import("../src/entities/meeting/lib/recordingFile.ts");
const { uploadMeetingRecording, fetchMeetingRecordingUrl, deleteMeeting, cancelMeetingTranscription } = await import("../src/entities/meeting/api/meetings.ts");
const { describeMeetingRecordingError, describeMeetingTranscriptionFailure } = await import("../src/shared/lib/aiErrorCodes.ts");
const { canDeleteMeetingInPhase, describeRecordingError, isMeetingBusyPhase, meetingProgressText, MEETING_TITLES, shouldConfirmLeavingPhase } = await import("../src/features/meeting-dictation/lib/meetingNotesFlow.ts");
const { transcriptFromSegments, transcriptLines, hasFinalSegments } = await import("../src/features/meeting-dictation/lib/liveTranscript.ts");
const { ApiError, INSUFFICIENT_CREDIT_MESSAGE } = await import("../src/shared/lib/apiErrors.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");

const file = (name, type, size) => ({ name, type, size });

test("녹음 파일은 서버가 받는 형식이면 그대로, 브라우저가 형식을 비우거나 다르게 알리면 확장자로 정한다", () => {
  assert.deepEqual(checkRecordingFile(file("a.m4a", "audio/x-m4a", 10)), { ok: true, contentType: "audio/x-m4a" });
  assert.deepEqual(checkRecordingFile(file("a.webm", "audio/webm;codecs=opus", 10)), { ok: true, contentType: "audio/webm" });
  assert.deepEqual(checkRecordingFile(file("a.MP3", "", 10)), { ok: true, contentType: "audio/mpeg" });
  assert.deepEqual(checkRecordingFile(file("a.mp3", "audio/mp3", 10)), { ok: true, contentType: "audio/mpeg" });
  assert.deepEqual(checkRecordingFile(file("a.wav", "audio/vnd.wave", 10)), { ok: true, contentType: "audio/wav" });
});

test("지원하지 않는 형식·빈 파일·500 MiB 초과는 올리기 전에 막는다", () => {
  assert.deepEqual(checkRecordingFile(file("a.mp4", "video/mp4", 10)), { ok: false, message: MEETING_RECORDING_FILE_MESSAGES.unsupported });
  assert.deepEqual(checkRecordingFile(file("a.txt", "text/plain", 10)), { ok: false, message: MEETING_RECORDING_FILE_MESSAGES.unsupported });
  assert.deepEqual(checkRecordingFile(file("a.wav", "audio/wav", 0)), { ok: false, message: MEETING_RECORDING_FILE_MESSAGES.empty });
  assert.equal(checkRecordingFile(file("a.wav", "audio/wav", MEETING_RECORDING_MAX_BYTES)).ok, true);
  assert.deepEqual(checkRecordingFile(file("a.wav", "audio/wav", MEETING_RECORDING_MAX_BYTES + 1)), { ok: false, message: MEETING_RECORDING_FILE_MESSAGES.tooLarge });
});

test("회의 이름은 확장자를 뺀 파일 이름이고 200자로 자른다", () => {
  assert.equal(meetingNameFromFile("주간 회의 10-13.m4a"), "주간 회의 10-13");
  assert.equal(meetingNameFromFile(".wav"), "");
  assert.equal(meetingNameFromFile(`${"가".repeat(250)}.mp3`).length, 200);
});

test("업로드·전사·재생·삭제 오류 code는 한국어 문구로, 크레딧 부족은 앱 공통 문구로 바꾼다", () => {
  assert.match(describeMeetingRecordingError("MEETING_TRANSCRIBING"), /전사를 취소하거나/);
  assert.match(describeMeetingRecordingError("MEETING_UPLOAD_REJECTED"), /다시 올려 주세요/);
  assert.equal(describeMeetingRecordingError("모르는_코드"), null);
  assert.equal(describeRecordingError(new ApiError("서버 문구", 409, "MEETING_RECORDING_CHANGED"), "기본"), describeMeetingRecordingError("MEETING_RECORDING_CHANGED"));
  assert.equal(describeRecordingError(new ApiError("크레딧", 402, "INSUFFICIENT_CREDIT"), "기본"), INSUFFICIENT_CREDIT_MESSAGE);
  assert.equal(describeRecordingError(new ApiError("서버 문구", 500, "OTHER"), "기본"), "서버 문구");
  assert.equal(describeRecordingError("문자열", "기본"), "기본");
  assert.match(describeMeetingTranscriptionFailure("녹음이 3시간을 넘어 전사할 수 없습니다."), /3시간/);
  assert.match(describeMeetingTranscriptionFailure(null), /다시 올려 주세요/);
});

test("녹음 파일 단계는 닫을 수 없고, 회의 삭제는 멈춘·완성·저장된 단계에서만 한다", () => {
  for (const phase of ["uploading", "transcribing", "deleting", "recording", "saving"]) assert.equal(isMeetingBusyPhase(phase), true, phase);
  for (const phase of ["stopped", "ready", "applied", "generating", "previewing"]) assert.equal(isMeetingBusyPhase(phase), false, phase);
  assert.deepEqual(["stopped", "ready", "applied"].filter(canDeleteMeetingInPhase), ["stopped", "ready", "applied"]);
  for (const phase of ["transcribing", "generating", "uploading", "saving", "recording"]) assert.equal(canDeleteMeetingInPhase(phase), false, phase);
  assert.equal(meetingProgressText("uploading", 42), "녹음 파일을 올리고 있어요… 42%");
  assert.equal(meetingProgressText("uploading"), "녹음 파일을 올리고 있어요…");
  assert.match(meetingProgressText("transcribing"), /전사하고 있어요/);
  assert.equal(MEETING_TITLES.transcribing, "녹음 파일 전사 중");
});

test("올리는 중·전사 중에만 탭을 닫기 전에 확인을 받는다(떠나면 그 회의를 다시 열 수 없다)", () => {
  for (const phase of ["uploading", "transcribing"]) assert.equal(shouldConfirmLeavingPhase(phase), true, phase);
  for (const phase of ["idle", "stopped", "generating", "ready", "applied", "deleting", "recording"]) assert.equal(shouldConfirmLeavingPhase(phase), false, phase);
});

test("조회 API 전사 구간을 position 순 카드 줄로 바꾸고 확정 구간만 회의록 근거로 센다", () => {
  const transcript = transcriptFromSegments([
    { id: "s1_seg_0002", position: 2, status: "completed", text: "둘째" },
    { id: "s1_seg_0001", position: 1, status: "completed", text: "첫째" },
    { id: "s1_seg_0003", position: 3, status: "pending", text: null }
  ]);
  assert.deepEqual(transcriptLines(transcript), ["첫째", "둘째"]);
  assert.equal(hasFinalSegments(transcript), true);
  assert.equal(hasFinalSegments(transcriptFromSegments([{ id: "a", position: 1, status: "pending", text: null }])), false);
});

function browserEnv(t) {
  const original = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => (key === "fruition.workspace_id" ? "ws_test" : null),
      setItem() {},
      removeItem() {}
    }
  };
  t.after(() => {
    globalThis.window = original;
  });
  saveAccessToken("test-access");
}

/** 조각 PUT을 받는 XMLHttpRequest 대역. respond를 호출해야 끝난다. */
function installFakeXhr(t, onSend) {
  class FakeXhr {
    constructor() {
      this.upload = {};
      this.status = 0;
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    send(body) {
      this.body = body;
      onSend(this);
    }
    abort() {
      this.onabort?.();
    }
    respond(status) {
      this.status = status;
      this.onload?.();
    }
    /** 브라우저처럼 지금까지 보낸 바이트를 알린다. */
    progress(loaded) {
      this.upload.onprogress?.({ loaded, total: this.body.size, lengthComputable: true });
    }
  }
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXhr;
  t.after(() => {
    globalThis.XMLHttpRequest = original;
  });
}

const BASE = "/api/workspaces/ws_test/meetings/mtg_1";

test("녹음 업로드는 회의 녹음 경로로 content_type·size를 보내고 조각마다 진행을 알린 뒤 확정 응답(회의)을 돌려준다", async (t) => {
  browserEnv(t);
  const puts = [];
  installFakeXhr(t, (request) => {
    puts.push({ url: request.url, size: request.body.size });
    request.respond(200);
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
    if (path === `${BASE}/recording/uploads`) return Response.json({ ticket: "tk", part_size: 4, part_count: 3 });
    if (path === `${BASE}/recording/uploads/parts`) {
      const { first_part: first, count } = JSON.parse(init.body);
      return Response.json({ parts: Array.from({ length: count }, (_, index) => ({ part_number: first + index, url: `https://s3.example/p${first + index}` })) });
    }
    if (path === `${BASE}/recording/uploads/complete`) return Response.json({ meeting_id: "mtg_1", status: "transcribing" }, { status: 202 });
    throw new Error(`예상하지 못한 요청: ${path}`);
  });
  const progress = [];

  const result = await uploadMeetingRecording("mtg_1", new Blob(["0123456789"]), "audio/mp4", {
    onProgress: (sent, total) => progress.push([sent, total])
  });

  assert.equal(result.status, "transcribing");
  assert.deepEqual(calls[0].body, { content_type: "audio/mp4", size: 10 });
  assert.deepEqual(puts.map((put) => put.size).sort(), [2, 4, 4]);
  assert.deepEqual(progress.at(-1), [10, 10]);
  assert.equal(progress.length, 3);
  assert.deepEqual(calls.at(-1), { path: `${BASE}/recording/uploads/complete`, body: { ticket: "tk" } });
});

test("조각 하나짜리 녹음도 조각 안에서 보낸 바이트만큼 진행을 알린다(동시에 보내는 조각은 합산한다)", async (t) => {
  browserEnv(t);
  const sending = [];
  installFakeXhr(t, (request) => sending.push(request));
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path === `${BASE}/recording/uploads`) return Response.json({ ticket: "tk", part_size: 6, part_count: 2 });
    if (path === `${BASE}/recording/uploads/parts`) {
      const { first_part: first, count } = JSON.parse(init.body);
      return Response.json({ parts: Array.from({ length: count }, (_, index) => ({ part_number: first + index, url: `https://s3.example/p${first + index}` })) });
    }
    if (path === `${BASE}/recording/uploads/complete`) return Response.json({ meeting_id: "mtg_1", status: "transcribing" }, { status: 202 });
    throw new Error(`예상하지 못한 요청: ${path}`);
  });
  const progress = [];
  const upload = uploadMeetingRecording("mtg_1", new Blob(["0123456789"]), "audio/mp4", {
    onProgress: (sent, total) => progress.push([sent, total])
  });
  while (sending.length < 2) await new Promise((resolve) => setTimeout(resolve, 1));
  const [first, second] = sending.sort((a, b) => a.url.localeCompare(b.url));
  first.progress(3);
  second.progress(2);
  first.progress(6);
  first.respond(200);
  await new Promise((resolve) => setTimeout(resolve, 1));
  second.progress(4);
  second.respond(200);
  await upload;

  assert.deepEqual(progress, [[3, 10], [5, 10], [8, 10], [8, 10], [10, 10], [10, 10]]);
});

test("업로드를 중단하면 전송 중인 조각을 끊고 abort를 보낸 뒤 확정하지 않는다", async (t) => {
  browserEnv(t);
  installFakeXhr(t, () => {});
  const paths = [];
  t.mock.method(globalThis, "fetch", async (path) => {
    paths.push(path);
    if (path === `${BASE}/recording/uploads`) return Response.json({ ticket: "tk", part_size: 4, part_count: 1 });
    if (path === `${BASE}/recording/uploads/parts`) return Response.json({ parts: [{ part_number: 1, url: "https://s3.example/p1" }] });
    if (path === `${BASE}/recording/uploads/abort`) return new Response(null, { status: 204 });
    throw new Error(`예상하지 못한 요청: ${path}`);
  });
  const controller = new AbortController();
  const upload = uploadMeetingRecording("mtg_1", new Blob(["abcd"]), "audio/wav", { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();

  await assert.rejects(upload, /중단/);
  assert.ok(paths.includes(`${BASE}/recording/uploads/abort`));
  assert.ok(!paths.includes(`${BASE}/recording/uploads/complete`));
});

/** 조각 PUT은 바로 끝나고, complete 응답 직전에 beforeComplete를 부르는 회의 녹음 서버. */
function recordingServer(t, { beforeComplete, cancel }) {
  installFakeXhr(t, (request) => request.respond(200));
  const paths = [];
  t.mock.method(globalThis, "fetch", async (path) => {
    paths.push(path);
    if (path === `${BASE}/recording/uploads`) return Response.json({ ticket: "tk", part_size: 4, part_count: 1 });
    if (path === `${BASE}/recording/uploads/parts`) return Response.json({ parts: [{ part_number: 1, url: "https://s3.example/p1" }] });
    if (path === `${BASE}/recording/uploads/complete`) {
      beforeComplete();
      return Response.json({ meeting_id: "mtg_1", status: "transcribing" }, { status: 202 });
    }
    if (path === `${BASE}/transcription/cancel`) return cancel();
    if (path === `${BASE}/recording/uploads/abort`) return new Response(null, { status: 204 });
    throw new Error(`예상하지 못한 요청: ${path}`);
  });
  return paths;
}

test("complete를 보내는 동안 올리기를 취소하면 202 뒤 이미 시작된 전사를 바로 취소하고 중단으로 끝낸다", async (t) => {
  browserEnv(t);
  const controller = new AbortController();
  const paths = recordingServer(t, {
    beforeComplete: () => controller.abort(),
    cancel: () => Response.json({ meeting_id: "mtg_1", status: "failed", error: "전사를 취소했습니다. 녹음을 다시 올려 주세요." })
  });

  await assert.rejects(uploadMeetingRecording("mtg_1", new Blob(["abcd"]), "audio/wav", { signal: controller.signal }), /중단/);
  assert.equal(paths.at(-1), `${BASE}/transcription/cancel`);
});

test("complete 뒤 전사 취소가 실패하면 전사 중인 회의를 돌려줘 화면이 전사 취소를 다시 받게 한다", async (t) => {
  browserEnv(t);
  const controller = new AbortController();
  recordingServer(t, {
    beforeComplete: () => controller.abort(),
    cancel: () => Response.json({ error: { code: "INTERNAL", message: "x" } }, { status: 503 })
  });

  const result = await uploadMeetingRecording("mtg_1", new Blob(["abcd"]), "audio/wav", { signal: controller.signal });
  assert.equal(result.status, "transcribing");
});

test("취소하지 않은 업로드는 complete 뒤 전사 취소를 보내지 않는다", async (t) => {
  browserEnv(t);
  const paths = recordingServer(t, { beforeComplete: () => {}, cancel: () => assert.fail("취소를 보내면 안 된다") });

  assert.equal((await uploadMeetingRecording("mtg_1", new Blob(["abcd"]), "audio/wav", { signal: new AbortController().signal })).status, "transcribing");
  assert.ok(!paths.includes(`${BASE}/transcription/cancel`));
});

test("재생 주소·전사 취소·삭제는 계약 경로를 부르고 실패는 code가 있는 ApiError로 던진다", async (t) => {
  browserEnv(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === `${BASE}/recording-url`) return Response.json({ url: "https://s3.example/r", expires_at: "2026-10-15T00:05:00Z" });
    if (path === `${BASE}/transcription/cancel`) return Response.json({ error: { code: "MEETING_NOT_TRANSCRIBING", message: "x" } }, { status: 409 });
    if (path === BASE) return new Response(null, { status: 204 });
    throw new Error(`예상하지 못한 요청: ${path}`);
  });

  assert.equal((await fetchMeetingRecordingUrl("mtg_1")).url, "https://s3.example/r");
  await assert.rejects(cancelMeetingTranscription("mtg_1"), (error) => error instanceof ApiError && error.code === "MEETING_NOT_TRANSCRIBING");
  await deleteMeeting("mtg_1");
  assert.deepEqual(calls, [`GET ${BASE}/recording-url`, `POST ${BASE}/transcription/cancel`, `DELETE ${BASE}`]);
});
