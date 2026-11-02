/**
 * 업로드 크기·개수 상한. document 서비스 기본값을 그대로 옮겨 둔 값이라 올리기 전에 명백히 큰 파일만 빨리 막는다.
 * 실제 판단은 서버가 하므로(FILE_TOO_LARGE·TOO_MANY_FILES 등) 서버 값이 바뀌면 여기만 고친다.
 * 테스트가 hook 없이 import할 수 있게 다른 모듈을 import하지 않는다.
 */

const MIB = 1024 * 1024;

/** PDF 직접 업로드(S3 multipart) 원본 상한. */
export const DOCUMENT_DIRECT_UPLOAD_MAX_BYTES = 100 * MIB;
/** multipart/form-data로 문서 API에 바로 올리는 경로의 상한. */
export const DOCUMENT_FORM_UPLOAD_MAX_BYTES = 50 * MIB;
/** 편집기 이미지 첨부 한 장의 상한. */
export const ATTACHMENT_MAX_BYTES = 10 * MIB;
/** 한 번 저장에 함께 보낼 수 있는 새 첨부 수. */
export const ATTACHMENTS_PER_SAVE_MAX = 20;
/** 회의 녹음 원본 상한. */
export const MEETING_RECORDING_MAX_BYTES = 500 * MIB;
/** 음성 받아쓰기 오디오 본문 상한. */
export const SPEECH_MAX_BYTES = 24 * MIB;

/** 상한을 넘으면 사용자 안내 문구를, 아니면 null을 돌려준다. */
export function uploadSizeLimitMessage(file: { size: number }, maxBytes: number): string | null {
  if (file.size <= maxBytes) return null;
  return `파일이 너무 커요. ${Math.floor(maxBytes / MIB)}MB 이하 파일만 올릴 수 있어요.`;
}
