// document-svc 회의 녹음 원본 라우트(#148, Fruition-document docs/api/meetings.md "녹음 원본과 회의 삭제").
// 브라우저→S3 직접 multipart(start·parts·조각 PUT·complete·abort), 녹음 파일 전사(transcribing → open|failed)·전사 취소,
// 5분짜리 재생 주소를 흉내 낸다. S3 대신 mock 자신의 /api/mock-storage/* 경로가 조각을 받고 녹음을 내준다(next rewrite로 같은 출처).
//
// 환경 변수: MOCK_MEETING_PART_SIZE(조각 크기, 기본 64 MiB), MOCK_MEETING_TRANSCRIBE_MS(전사 시간, 기본 6000),
// MOCK_MEETING_TRANSCRIPTION_ERROR(전사 실패 문구로 failed), MOCK_MEETING_RECORDING_URL_TTL_MS(재생 주소 유효 시간, 기본 5분),
// MOCK_INSUFFICIENT_CREDIT=1(녹음 파일 회의 업로드 시작이 402),
// MOCK_MEETING_COMPLETE_DELAY_MS(확정 요청을 이만큼 붙잡은 뒤 확정한다. 확정 중 취소 확인용, 기본 0).
import { randomUUID } from "node:crypto";
import { error, requireWorkspace, state } from "../state.mjs";

const MAX_BYTES = 500 * 1024 * 1024;
const MIN_PART_SIZE = 64 * 1024 * 1024;
const MAX_PARTS_PER_REQUEST = 32;
const DEFAULT_TRANSCRIBE_MS = 6_000;
const DEFAULT_URL_TTL_MS = 5 * 60_000;
const UPLOAD_PATH = "/api/mock-storage/meeting-uploads";
const PLAYBACK_PATH = "/api/mock-storage/meeting-recordings";
const ACCEPTED = { "audio/wav": "audio/wav", "audio/x-wav": "audio/wav", "audio/mpeg": "audio/mpeg", "audio/mp4": "audio/mp4", "audio/x-m4a": "audio/mp4", "audio/webm": "audio/webm" };
const CANCELLED_MESSAGE = "전사를 취소했습니다. 녹음을 다시 올려 주세요.";

// 녹음 파일 전사 결과로 돌려줄 문장. 실제 음성 내용과 상관없다.
const TRANSCRIPT = [
  "녹음 파일로 진행한 주간 회의를 시작하겠습니다.",
  "지난주 베타 출시 이후 들어온 문의는 대부분 로그인 관련이었습니다.",
  "비밀번호 재설정 메일 지연은 이번 주 안에 수정하기로 하겠습니다.",
  "다음 회의에서 사용자 피드백을 다시 논의하겠습니다."
];

const partSize = () => Math.max(1, Number(process.env.MOCK_MEETING_PART_SIZE ?? MIN_PART_SIZE));
const transcribeMs = () => Number(process.env.MOCK_MEETING_TRANSCRIBE_MS ?? DEFAULT_TRANSCRIBE_MS);
const urlTtlMs = () => Number(process.env.MOCK_MEETING_RECORDING_URL_TTL_MS ?? DEFAULT_URL_TTL_MS);
const completeDelayMs = () => Number(process.env.MOCK_MEETING_COMPLETE_DELAY_MS ?? 0);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const later = (ms, fn) => (ms > 0 ? setTimeout(fn, ms).unref() : setImmediate(fn));

// ticket → 진행 중인 업로드, token → 재생 주소. 테스트가 state를 비워도 동작하게 모듈에 둔다.
const uploads = new Map();
const playbackTokens = new Map();

function audioType(raw) {
  return ACCEPTED[String(raw ?? "").split(";", 1)[0].trim().toLowerCase()] ?? null;
}

function canUpload(meeting) {
  if (meeting.source === "upload") return meeting.status === "awaiting_upload" || meeting.status === "failed";
  return meeting.status === "open" && !meeting.recording && !meeting.live_connected;
}

function uploadFor(ctx, meeting, ticket) {
  const upload = ticket ? uploads.get(ticket) : null;
  if (!upload) {
    error(ctx, 400, "업로드 ticket이 만료되었거나 올바르지 않습니다.", "MEETING_UPLOAD_REJECTED");
    return null;
  }
  if (upload.meetingId !== meeting.meeting_id || upload.userId !== ctx.user.id) {
    error(ctx, 403, "다른 회의의 업로드를 사용할 수 없습니다.", "MEETING_UPLOAD_REJECTED");
    return null;
  }
  return upload;
}

/** 확정 뒤 일정 시간이 지나면 전사 결과를 회의에 반영한다. 취소·재업로드·삭제로 run이 바뀌었으면 버린다. */
function scheduleTranscription(meeting) {
  const runId = randomUUID();
  meeting.transcription_run_id = runId;
  later(transcribeMs(), () => {
    if (meeting.transcription_run_id !== runId || meeting.status !== "transcribing") return;
    const failure = process.env.MOCK_MEETING_TRANSCRIPTION_ERROR;
    if (failure) {
      Object.assign(meeting, { status: "failed", error: failure === "1" ? "녹음 파일을 전사하지 못했습니다. 다시 올려 주세요." : failure });
      return;
    }
    meeting.segments = TRANSCRIPT.map((text, index) => ({
      id: `s1_seg_${String(index + 1).padStart(4, "0")}`, position: index + 1, status: "completed", text
    }));
    meeting.streams = [{ stream_order: 1, end_reason: "finished" }];
    Object.assign(meeting, { status: "open", error: null });
  });
}

/** 회의를 지울 때 녹음 원본·진행 중인 업로드·재생 주소도 함께 버린다. */
export function forgetMeetingRecording(meetingId) {
  for (const [ticket, upload] of uploads) if (upload.meetingId === meetingId) uploads.delete(ticket);
  for (const [token, entry] of playbackTokens) if (entry.meetingId === meetingId) playbackTokens.delete(token);
}

/**
 * findOwnMeeting·toMeetingResponse는 meetings.mjs의 것을 받는다(회의 조회와 같은 404·응답 모양).
 */
export function registerMeetingRecordingRoutes(router, { findOwnMeeting, toMeetingResponse }) {
  const own = (ctx) => {
    const workspace = requireWorkspace(ctx);
    return workspace ? findOwnMeeting(ctx, workspace.id) : null;
  };

  router.post("/api/workspaces/:wid/meetings/:mid/recording/uploads", async (ctx) => {
    const meeting = own(ctx);
    if (!meeting) return;
    const body = await ctx.body();
    const contentType = audioType(body.content_type);
    if (!contentType) return error(ctx, 415, "WAV, MP3, M4A, WebM 녹음 파일만 올릴 수 있습니다.", "MEETING_RECORDING_UNSUPPORTED");
    const size = Number(body.size);
    if (!Number.isSafeInteger(size) || size <= 0) return error(ctx, 422, "녹음 파일이 비어 있습니다.", "MEETING_RECORDING_EMPTY");
    if (size > MAX_BYTES) return error(ctx, 413, "녹음 파일은 500 MiB 이하로 올려 주세요.", "MEETING_RECORDING_TOO_LARGE");
    if (!canUpload(meeting)) return error(ctx, 409, "지금은 녹음 원본을 올릴 수 없습니다.", "MEETING_RECORDING_NOT_ALLOWED");
    if (meeting.source === "upload" && ["1", "true"].includes(process.env.MOCK_INSUFFICIENT_CREDIT ?? "")) {
      return error(ctx, 402, "크레딧이 부족해 작업을 시작하지 않았습니다.", "INSUFFICIENT_CREDIT");
    }
    const ticket = `mrt_${randomUUID().replaceAll("-", "")}`;
    const partBytes = partSize();
    const partCount = Math.ceil(size / partBytes);
    uploads.set(ticket, { meetingId: meeting.meeting_id, userId: ctx.user.id, contentType, size, partBytes, partCount, parts: new Map() });
    ctx.json(200, { ticket, part_size: partBytes, part_count: partCount });
  });

  router.post("/api/workspaces/:wid/meetings/:mid/recording/uploads/parts", async (ctx) => {
    const meeting = own(ctx);
    if (!meeting) return;
    const body = await ctx.body();
    const upload = uploadFor(ctx, meeting, body.ticket);
    if (!upload) return;
    const first = Number(body.first_part);
    const count = Number(body.count);
    if (!Number.isInteger(first) || !Number.isInteger(count) || first < 1 || count < 1 || count > MAX_PARTS_PER_REQUEST || first + count - 1 > upload.partCount) {
      return error(ctx, 400, "조각 번호가 올바르지 않습니다.", "MEETING_UPLOAD_REJECTED");
    }
    const parts = Array.from({ length: count }, (_, index) => ({ part_number: first + index, url: `${UPLOAD_PATH}/${body.ticket}/${first + index}` }));
    ctx.json(200, { parts });
  });

  // presigned PUT 대역. 인증 헤더 없이 ticket으로만 받는다.
  router.put(`${UPLOAD_PATH}/:ticket/:part`, async (ctx) => {
    const upload = uploads.get(ctx.params.ticket);
    const part = Number(ctx.params.part);
    if (!upload || !Number.isInteger(part) || part < 1 || part > upload.partCount) return ctx.json(403, { error: { message: "AccessDenied" } });
    upload.parts.set(part, await ctx.raw());
    ctx.json(200, {}, { ETag: `"${randomUUID()}"` });
  }, { open: true });

  router.post("/api/workspaces/:wid/meetings/:mid/recording/uploads/abort", async (ctx) => {
    const meeting = own(ctx);
    if (!meeting) return;
    const body = await ctx.body();
    if (!uploadFor(ctx, meeting, body.ticket)) return;
    uploads.delete(body.ticket);
    ctx.json(204, null);
  });

  router.post("/api/workspaces/:wid/meetings/:mid/recording/uploads/complete", async (ctx) => {
    const meeting = own(ctx);
    if (!meeting) return;
    const body = await ctx.body();
    if (completeDelayMs() > 0) await sleep(completeDelayMs());
    // 응답이 유실돼 다시 부른 확정은 현재 회의를 돌려준다.
    if (body.ticket && meeting.recording_ticket === body.ticket) return ctx.json(meeting.status === "transcribing" ? 202 : 200, toMeetingResponse(meeting));
    const upload = uploadFor(ctx, meeting, body.ticket);
    if (!upload) return;
    if (!canUpload(meeting)) return error(ctx, 409, "지금은 녹음 원본을 올릴 수 없습니다.", "MEETING_RECORDING_NOT_ALLOWED");
    const chunks = [];
    for (let part = 1; part <= upload.partCount; part += 1) {
      const chunk = upload.parts.get(part);
      const expected = part < upload.partCount ? upload.partBytes : upload.size - upload.partBytes * (upload.partCount - 1);
      if (!chunk || chunk.length !== expected) {
        uploads.delete(body.ticket);
        return error(ctx, 400, "올린 파일 크기가 처음 알린 크기와 다릅니다.", "MEETING_RECORDING_SIZE_MISMATCH");
      }
      chunks.push(chunk);
    }
    uploads.delete(body.ticket);
    Object.assign(meeting, { recording: Buffer.concat(chunks), recording_content_type: upload.contentType, recording_ticket: body.ticket });
    if (meeting.source !== "upload") return ctx.json(200, toMeetingResponse(meeting));
    Object.assign(meeting, { status: "transcribing", error: null, segments: [], streams: [] });
    scheduleTranscription(meeting);
    ctx.json(202, toMeetingResponse(meeting));
  });

  router.post("/api/workspaces/:wid/meetings/:mid/transcription/cancel", (ctx) => {
    const meeting = own(ctx);
    if (!meeting) return;
    if (meeting.status !== "transcribing") return error(ctx, 409, "전사 중인 회의가 아닙니다.", "MEETING_NOT_TRANSCRIBING");
    Object.assign(meeting, { status: "failed", error: CANCELLED_MESSAGE, transcription_run_id: null });
    ctx.json(200, toMeetingResponse(meeting));
  });

  router.get("/api/workspaces/:wid/meetings/:mid/recording-url", (ctx) => {
    const meeting = own(ctx);
    if (!meeting) return;
    if (!meeting.recording) return error(ctx, 404, "녹음 원본이 없습니다.", "MEETING_RECORDING_NOT_FOUND");
    const token = randomUUID().replaceAll("-", "");
    const expiresAt = Date.now() + urlTtlMs();
    playbackTokens.set(token, { meetingId: meeting.meeting_id, expiresAt });
    ctx.json(200, { url: `${PLAYBACK_PATH}/${token}`, expires_at: new Date(expiresAt).toISOString() });
  });

  // presigned GET 대역. 만료되면 S3처럼 403이다. <audio>가 위치를 옮길 수 있게 Range 요청을 받는다.
  router.get(`${PLAYBACK_PATH}/:token`, (ctx) => {
    const entry = playbackTokens.get(ctx.params.token);
    const meeting = entry && entry.expiresAt > Date.now() ? state.meetings.find((item) => item.meeting_id === entry.meetingId) : null;
    if (!meeting?.recording) return ctx.json(403, { error: { message: "Request has expired" } });
    const bytes = meeting.recording;
    const range = /^bytes=(\d*)-(\d*)$/.exec(ctx.req.headers.range ?? "");
    if (!range) return ctx.bytes(200, bytes, meeting.recording_content_type, { "Accept-Ranges": "bytes" });
    const start = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (start >= bytes.length || start > end) return ctx.bytes(416, Buffer.alloc(0), meeting.recording_content_type, { "Content-Range": `bytes */${bytes.length}` });
    ctx.bytes(206, bytes.subarray(start, end + 1), meeting.recording_content_type, {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${bytes.length}`
    });
  }, { open: true });
}
