// 녹음 파일 업로드 전 확인(document MeetingRecordingService 검증 값과 같다, docs/api/meetings.md#meeting-recording).

import { MEETING_RECORDING_MAX_BYTES } from "@/shared/config/uploadLimits";

/** 녹음 원본 상한 500 MiB. 녹음 길이 한도(3시간)는 전사 단계에서 AI가 확인한다. */
export { MEETING_RECORDING_MAX_BYTES };

/** 서버가 받는 형식(type/subtype). audio/x-wav·audio/x-m4a는 서버가 audio/wav·audio/mp4로 바꾼다. */
const ACCEPTED_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/webm"]);

/** 브라우저가 형식을 비워 두거나(audio/mp3, audio/vnd.wave 등) 다르게 알리면 확장자로 정한다. */
const TYPE_BY_EXTENSION: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  webm: "audio/webm"
};

/** 파일 선택 창의 accept. 형식과 확장자를 함께 적어 브라우저마다 다른 MIME 판별에 기대지 않는다. */
export const MEETING_RECORDING_ACCEPT = "audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/webm,.wav,.mp3,.m4a,.webm";

/** 올릴 수 없는 녹음 파일의 사유. 문구는 meeting 메시지 recordingFile 아래에 둔다. */
export type RecordingFileRejection = "unsupported" | "empty" | "tooLarge";

export type RecordingFileCheck = { ok: true; contentType: string } | { ok: false; reason: RecordingFileRejection };

/** 업로드 시작(content_type·size)에 보낼 형식을 정하고, 서버가 거절할 파일은 올리기 전에 막는다. */
export function checkRecordingFile(file: { name: string; type: string; size: number }): RecordingFileCheck {
  const declared = file.type.split(";", 1)[0].trim().toLowerCase();
  const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const contentType = ACCEPTED_TYPES.has(declared) ? declared : TYPE_BY_EXTENSION[extension];
  if (!contentType) return { ok: false, reason: "unsupported" };
  if (file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > MEETING_RECORDING_MAX_BYTES) return { ok: false, reason: "tooLarge" };
  return { ok: true, contentType };
}

/** 파일 이름에서 확장자를 뺀 회의 이름. 서버 한도(200자)에 맞춘다. 비면 서버 기본값(회의록)을 쓴다. */
export function meetingNameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim().slice(0, 200);
}
