import { apiFetch, ERROR_MESSAGES, getWorkspaceId, parseApiError, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import {
  createPcmAssembler,
  createSpeechEventParser,
  decodeBase64,
  SPEECH_PLAYBACK_MESSAGES,
  SpeechStreamError
} from "../lib/speechPlayback";

type SpeechTranscriptionResponse = { text: string };

/**
 * 녹음한 음성을 텍스트로 바꾼다. 본문은 오디오 bytes 그대로(multipart 아님)이고
 * Content-Type은 `audio/webm;codecs=opus`처럼 파라미터가 붙어도 된다.
 * 무음이면 빈 문자열이 온다. 결과는 입력창에 채우기만 하고 자동으로 전송하지 않는다.
 */
export async function transcribeSpeech(audio: Blob, contentType = audio.type): Promise<string> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "speech", "transcriptions"), {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: audio
  });
  const body = await parseJsonOrThrow<SpeechTranscriptionResponse>(response, ERROR_MESSAGES.speechTranscribeFailed);
  return typeof body.text === "string" ? body.text : "";
}

/**
 * 완료된 assistant 답변을 음성으로 스트리밍 받는다(#149). 응답은 NDJSON이고 `audio` 이벤트의 base64 PCM16을
 * Float32 샘플로 바꿔 onAudio로 넘긴다. `done`이면 정상 종료, `error`면 SpeechStreamError, HTTP 오류는 ApiError다.
 * signal을 abort하면 서버가 합성을 멈추고 그때까지 생성된 만큼만 과금된다.
 */
export async function streamSpeechSynthesis(
  messageId: string,
  { signal, onAudio }: { signal: AbortSignal; onAudio: (samples: Float32Array) => void }
): Promise<void> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "speech", "synthesis"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_id: messageId }),
    cache: "no-store",
    signal
  });
  if (!response.ok) throw await parseApiError(response, SPEECH_PLAYBACK_MESSAGES.failed);
  if (!response.body) throw new Error(SPEECH_PLAYBACK_MESSAGES.failed);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSpeechEventParser();
  const pcm = createPcmAssembler();
  try {
    while (true) {
      const { done, value } = await reader.read();
      const events = done ? parser.flush() : parser.push(decoder.decode(value, { stream: true }));
      for (const event of events) {
        if (event.type === "audio") onAudio(pcm.push(decodeBase64(event.delta)));
        else if (event.type === "done") return;
        else throw new SpeechStreamError(event.code);
      }
      // 종결 이벤트 없이 연결이 끊긴 것은 실패다.
      if (done) throw new Error(SPEECH_PLAYBACK_MESSAGES.failed);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
