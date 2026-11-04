import type { MeetingNotesResponse } from "@/entities/meeting";
import { ApiError } from "@/shared/lib/apiErrors";

// 회의록을 새 문서로 저장할 때의 이름 규칙과 재시도. 같은 폴더에 같은 이름이 있으면 서버가 409 DUPLICATE_NAME으로 거절한다.

const DEFAULT_MEETING_NAME = "회의록";
// 서버 한도는 확장자를 포함해 255자다. 번호를 붙일 자리를 남긴다(recordingFile의 회의 이름 길이와 같다).
const MAX_BASE_NAME_LENGTH = 200;
/** 저장 한 번에 이름을 바꿔 보내는 최대 횟수 */
export const MAX_NAME_ATTEMPTS = 10;

const pad = (value: number) => String(value).padStart(2, "0");

function startedAtLabel(startedAt: string): string | null {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}시 ${pad(date.getMinutes())}분`;
}

/**
 * 저장할 문서의 기본 이름. 실시간 녹음은 이름이 항상 "회의록"이라 회의 시작 시각을 붙여 알아볼 수 있게 한다.
 * 올린 녹음 파일처럼 이름이 있으면 그 이름을 쓴다. 서버가 거절하는 문자(`/`, `\`, 제어 문자)는 공백으로 바꾼다.
 */
export function meetingDocumentBaseName(notesName: string | null | undefined, startedAt: string): string {
  const name = (notesName ?? "").replace(/[\\/\p{Cc}]+/gu, " ").trim().slice(0, MAX_BASE_NAME_LENGTH).trim();
  if (name !== "" && name !== DEFAULT_MEETING_NAME) return name;
  const label = startedAtLabel(startedAt);
  return label ? `${DEFAULT_MEETING_NAME} ${label}` : DEFAULT_MEETING_NAME;
}

/** nameIndex 0은 이름 그대로, 1부터 " (2)", " (3)" … */
export function numberedMeetingDocumentName(baseName: string, nameIndex: number): string {
  return nameIndex === 0 ? baseName : `${baseName} (${nameIndex + 1})`;
}

export type NotesSaveAttempt = { nameIndex: number; key: string };

/**
 * 이름이 겹치면 다음 번호로 다시 보낸다. 거절된 저장은 문서를 만들지 않으므로 새 멱등 키를 쓴다.
 * 그 밖의 오류는 저장 여부를 알 수 없어 바로 올린다. 호출자가 attempt를 그대로 다시 보내면(같은 이름·같은 키)
 * 서버가 처음 저장을 이어 가거나 같은 결과를 돌려줘 문서가 둘 생기지 않는다.
 */
export async function saveNotesUnderUniqueName<T>(input: {
  baseName: string;
  attempt: NotesSaveAttempt;
  createKey: () => string;
  onAttemptChange: (attempt: NotesSaveAttempt) => void;
  save: (displayName: string, key: string) => Promise<T>;
}): Promise<T> {
  let attempt = input.attempt;
  for (let sent = 1; ; sent += 1) {
    try {
      return await input.save(numberedMeetingDocumentName(input.baseName, attempt.nameIndex), attempt.key);
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "DUPLICATE_NAME")) throw error;
      attempt = { nameIndex: attempt.nameIndex + 1, key: input.createKey() };
      input.onAttemptChange(attempt);
      if (sent >= MAX_NAME_ATTEMPTS) throw error;
    }
  }
}

/** 저장 요청이 실패했을 때 서버에 이미 저장됐는지 본다(응답만 끊겼거나 먼저 저장된 경우). 알 수 없으면 null */
export async function findAppliedNotes(fetchLatest: () => Promise<MeetingNotesResponse>): Promise<MeetingNotesResponse | null> {
  try {
    const latest = await fetchLatest();
    return latest.status === "applied" && latest.applied ? latest : null;
  } catch {
    return null;
  }
}
