import { apiFetch, ERROR_MESSAGES, getWorkspaceId, parseJsonOrThrow, workspacePath } from "@/shared/api/client";

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
