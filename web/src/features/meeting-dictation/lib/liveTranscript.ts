import type { MeetingSegment } from "@/entities/meeting/model/meeting";
import type { LiveServerEvent } from "./liveProtocol";

// 받아쓰는 중 카드에 쌓이는 전사. committed가 발화 순서(position)를 정하고, delta는 확정 전 임시 글,
// completed는 서버가 저장한 확정 문장이다. delta가 committed보다 먼저 올 수 있어 position 없는 구간은 마지막에 둔다.

type TranscriptSegment = { position: number | null; text: string; isFinal: boolean };

export type LiveTranscript = { readonly segments: Readonly<Record<string, TranscriptSegment>> };

export const EMPTY_TRANSCRIPT: LiveTranscript = { segments: {} };

export function applyLiveEvent(transcript: LiveTranscript, event: LiveServerEvent): LiveTranscript {
  if (event.type !== "committed" && event.type !== "delta" && event.type !== "completed") return transcript;
  const current = transcript.segments[event.segment_id] ?? { position: null, text: "", isFinal: false };
  let next: TranscriptSegment;
  if (event.type === "committed") {
    next = { ...current, position: event.position };
  } else if (event.type === "delta") {
    // 확정 문장이 이미 왔으면 늦은 조각은 버린다.
    if (current.isFinal) return transcript;
    next = { ...current, text: current.text + event.text };
  } else {
    next = { ...current, text: event.text, isFinal: true };
  }
  return { segments: { ...transcript.segments, [event.segment_id]: next } };
}

/** 화면에 보일 줄. position 순서, position 없는 구간은 받은 순서대로 마지막. 빈 구간은 뺀다. */
export function transcriptLines(transcript: LiveTranscript): string[] {
  const entries = Object.values(transcript.segments);
  const positioned = entries.filter((segment) => segment.position !== null)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const pending = entries.filter((segment) => segment.position === null);
  return [...positioned, ...pending].map((segment) => segment.text.trim()).filter(Boolean);
}

/** 확정(저장)된 구간이 하나라도 있는지. 없으면 회의록을 만들 수 없다(422 MEETING_TRANSCRIPT_EMPTY). */
export function hasFinalSegments(transcript: LiveTranscript): boolean {
  return Object.values(transcript.segments).some((segment) => segment.isFinal && segment.text.trim().length > 0);
}

/** 조회 API의 전사 구간(녹음 파일 전사 결과)을 카드에 보일 전사로 바꾼다. 확정(completed) 구간만 회의록 근거가 된다. */
export function transcriptFromSegments(segments: readonly MeetingSegment[]): LiveTranscript {
  const entries = segments.map((segment) => [
    segment.id,
    { position: segment.position, text: segment.text ?? "", isFinal: segment.status === "completed" }
  ] as const);
  return { segments: Object.fromEntries(entries) };
}
