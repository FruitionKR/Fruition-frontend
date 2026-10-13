// document-svc(8080) 음성 전사 라우트: 채팅 입력창 마이크 녹음을 텍스트로 바꾼다. 음성·텍스트를 저장하지 않는다.
import { error, requireWorkspace, sleep } from "../state.mjs";

const SUPPORTED_AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav"];
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
// 실제 모델처럼 1~2초 걸리는 것을 흉내 낸다. MOCK_SPEECH_DELAY_MS로 고정할 수 있다.
const TRANSCRIBE_DELAY_MS = 1_500;

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
}
