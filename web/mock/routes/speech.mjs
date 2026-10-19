// document-svc(8080) 음성 라우트: 채팅 입력창 마이크 녹음을 텍스트로 바꾸고(저장하지 않는다),
// 완료된 assistant 답변을 PCM NDJSON 스트림으로 들려준다(#149).
import { error, requireWorkspace, sleep, state } from "../state.mjs";

const SUPPORTED_AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav"];
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
// 실제 모델처럼 1~2초 걸리는 것을 흉내 낸다. MOCK_SPEECH_DELAY_MS로 고정할 수 있다.
const TRANSCRIBE_DELAY_MS = 1_500;

// 답변 듣기 스트림: 16비트 모노 24kHz PCM을 base64 조각으로 보낸다. 글자 수에 비례한 길이의 낮은 음(220Hz)이다.
const SPEECH_SAMPLE_RATE = 24_000;
const SPEECH_CHUNK_BYTES = 9_601; // 홀수 바이트로 잘라 샘플 경계 이어 붙이기를 검증한다.
const SPEECH_CHUNK_DELAY_MS = 120;
const SPEECH_SECONDS_PER_CHAR = 0.05;
const SPEECH_MAX_SECONDS = 8;
const SPEECH_INPUT_LIMIT_CHARS = 8_000;

/** 서버의 텍스트 정리 규칙을 흉내 낸다: 코드 블록·인용 번호·마크다운 기호를 걷어 낸 읽을 글. */
export function speechText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[\^?\d+(?:,\s*\d+)*\]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function synthesisPcm(text) {
  const seconds = Math.min(SPEECH_MAX_SECONDS, Math.max(0.5, text.length * SPEECH_SECONDS_PER_CHAR));
  const sampleCount = Math.round(seconds * SPEECH_SAMPLE_RATE);
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.min(1, index / 2_000, (sampleCount - index) / 2_000);
    pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * index) / SPEECH_SAMPLE_RATE) * 0.15 * envelope * 32767), index * 2);
  }
  return pcm;
}

export function registerSpeechRoutes(router) {
  router.post("/api/workspaces/:wid/speech/transcriptions", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    // `audio/webm;codecs=opus`처럼 파라미터가 붙어도 받는다.
    const contentType = (ctx.req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (!SUPPORTED_AUDIO_TYPES.includes(contentType)) return error(ctx, 415, "지원하지 않는 오디오 형식입니다.", "UNSUPPORTED_MEDIA_TYPE");
    const audio = await ctx.raw();
    if (audio.length === 0) return error(ctx, 422, "빈 음성입니다.", "EMPTY_AUDIO");
    if (audio.length > MAX_AUDIO_BYTES) return error(ctx, 413, "오디오는 24 MiB 이하여야 합니다.", "PAYLOAD_TOO_LARGE");
    await sleep(Number(process.env.MOCK_SPEECH_DELAY_MS ?? TRANSCRIBE_DELAY_MS));
    // MOCK_SPEECH_TEXT를 빈 문자열로 두면 무음 응답("인식된 음성이 없습니다" 안내)을 확인할 수 있다.
    const text = process.env.MOCK_SPEECH_TEXT ?? `(mock 전사) ${Math.round(audio.length / 1024)}KB 분량의 음성을 받아썼습니다.`;
    ctx.json(200, { text });
  });

  router.post("/api/workspaces/:wid/speech/synthesis", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { message_id } = await ctx.body();
    if (typeof message_id !== "string" || !message_id) return error(ctx, 400, "message_id가 필요합니다.");
    const message = state.chatMessages.find((item) => item.id === message_id);
    const session = message && state.chatSessions.find((item) => item.id === message.session_id && item.workspace_id === workspace.id);
    if (!message || !session || message.role !== "assistant") return error(ctx, 404, "답변을 찾을 수 없습니다.");
    if (message.status !== "completed") return error(ctx, 409, "아직 완료되지 않은 답변입니다.");
    const text = speechText(message.content ?? "");
    if (!text) return error(ctx, 422, "읽을 수 있는 글이 없는 답변입니다.");
    if (text.length > SPEECH_INPUT_LIMIT_CHARS) return error(ctx, 400, "답변이 너무 길어 음성으로 만들 수 없습니다.");
    const stream = ctx.ndjson();
    const pcm = synthesisPcm(text);
    // MOCK_SPEECH_ERROR=provider_unavailable 처럼 두면 첫 조각 뒤에 스트림 오류를 보낸다.
    const failWith = process.env.MOCK_SPEECH_ERROR;
    for (let offset = 0; offset < pcm.length; offset += SPEECH_CHUNK_BYTES) {
      if (stream.closed()) return; // 클라이언트가 멈추면(abort) 합성도 멈춘다.
      stream.send({ type: "audio", delta: pcm.subarray(offset, offset + SPEECH_CHUNK_BYTES).toString("base64") });
      if (failWith) {
        stream.send({ type: "error", code: failWith });
        return stream.close();
      }
      await sleep(Number(process.env.MOCK_SPEECH_CHUNK_DELAY_MS ?? SPEECH_CHUNK_DELAY_MS));
    }
    stream.send({ type: "done" });
    stream.close();
  });
}
