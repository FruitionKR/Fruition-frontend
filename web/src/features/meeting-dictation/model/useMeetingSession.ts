import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyMeetingNotes,
  cancelMeetingNotes,
  createMeeting,
  fetchMeetingNotes,
  issueMeetingLiveTicket,
  MEETING_ERROR_MESSAGES,
  previewMeetingNotesAppend,
  requestMeetingNotes,
  type MeetingAppendPreviewResponse,
  type MeetingNotesResponse,
  type MeetingResponse
} from "@/entities/meeting";
import { getDocumentTransport } from "@/shared/api/documentTransport";
import { describeMeetingNotesError } from "@/shared/lib/aiErrorCodes";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { describeMicrophoneError } from "@/features/agent-chat/lib/dictation";
import { buildLiveSocketUrl } from "../lib/liveProtocol";
import { applyLiveEvent, EMPTY_TRANSCRIPT, hasFinalSegments, type LiveTranscript } from "../lib/liveTranscript";
import {
  describeNotesRequestError,
  describeNotesSaveError,
  MEETING_MESSAGES,
  type MeetingPhase
} from "../lib/meetingNotesFlow";
import { createLiveSession, type LiveSession, type LiveSocket, type LiveStopResult } from "./liveSession";
import { isMicrophoneCaptureSupported, startMicrophoneCapture, type MicrophoneCapture } from "./microphoneCapture";

const NOTES_POLL_MS = 2_000;
// finished 직후 서버가 받아쓰기 잠금을 늦게 풀면 회의록 요청이 409 MEETING_LIVE_IN_USE를 받는다. 잠시 뒤 다시 보낸다.
const LIVE_RELEASE_RETRIES = 3;
const LIVE_RELEASE_DELAY_MS = 1_500;

export type MeetingNotice = { text: string; tone: "error" | "info" };

async function openLiveSocket(meetingId: string, ticket: string): Promise<LiveSocket> {
  const transport = await getDocumentTransport();
  return new WebSocket(buildLiveSocketUrl(transport.origin, window.location.origin, meetingId, ticket)) as unknown as LiveSocket;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 채팅 패널의 회의 받아쓰기(#148): 회의 생성 → 마이크·WebSocket 실시간 전사 → 멈추면 회의록 생성(비동기, 조회로 대기)
 * → 새 문서로 저장하거나 회의를 시작한 문서 끝에 추가(미리보기 → 저장).
 * documentId는 열린 Markdown 문서다. 있으면 회의록을 그 문서 끝에 추가할 대상으로 기억한다.
 */
export function useMeetingSession({
  documentId,
  onDocumentSaved
}: {
  documentId: string | null;
  onDocumentSaved?: (documentId: string) => Promise<void> | void;
}) {
  const [phase, setPhase] = useState<MeetingPhase>("idle");
  const [meeting, setMeeting] = useState<MeetingResponse | null>(null);
  const [transcript, setTranscript] = useState<LiveTranscript>(EMPTY_TRANSCRIPT);
  const [notes, setNotes] = useState<MeetingNotesResponse | null>(null);
  const [preview, setPreview] = useState<MeetingAppendPreviewResponse | null>(null);
  const [notice, setNotice] = useState<MeetingNotice | null>(null);
  const [canRequestPartial, setCanRequestPartial] = useState(false);
  const sessionRef = useRef<LiveSession | null>(null);
  // 시작 중(마이크 권한·회의 생성 대기)에 멈추거나 화면을 떠나면 값이 바뀌어 진행 중이던 시작을 버린다.
  const startAttemptRef = useRef(0);
  const microphoneRef = useRef<MicrophoneCapture | null>(null);
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const isMountedRef = useRef(true);
  const onDocumentSavedRef = useRef(onDocumentSaved);
  onDocumentSavedRef.current = onDocumentSaved;

  const releaseCapture = useCallback(() => {
    microphoneRef.current?.stop();
    microphoneRef.current = null;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      sessionRef.current?.dispose();
      sessionRef.current = null;
      microphoneRef.current?.stop();
      microphoneRef.current = null;
    };
  }, []);

  const generateNotes = useCallback(async (target: MeetingResponse, allowPartial = false) => {
    setPhase("generating");
    setNotice(null);
    setCanRequestPartial(false);
    // 같은 생성 요청의 재시도는 같은 키로 보낸다(같은 버전을 돌려받는다).
    const key = crypto.randomUUID();
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await requestMeetingNotes(target.meeting_id, { allowPartial, key });
        if (!isMountedRef.current) return;
        setNotes(response);
        if (response.status === "ready") setPhase("ready");
        else if (response.status === "failed") {
          setNotice({ text: describeMeetingNotesError(response.error_code), tone: "error" });
          setPhase("stopped");
        }
        return;
      } catch (error) {
        if (!isMountedRef.current) return;
        const described = describeNotesRequestError(error);
        if (described.liveStillOpen && attempt < LIVE_RELEASE_RETRIES) {
          await wait(LIVE_RELEASE_DELAY_MS);
          continue;
        }
        setCanRequestPartial(described.incomplete);
        setNotice({ text: described.message, tone: "error" });
        setPhase("stopped");
        return;
      }
    }
  }, []);

  const handleStopped = useCallback((target: MeetingResponse, result: LiveStopResult) => {
    sessionRef.current = null;
    releaseCapture();
    if (!isMountedRef.current) return;
    if (!result.ok) setNotice({ text: result.message, tone: "error" });
    // 저장된 문장이 없으면 회의록을 만들 수 없다(422). 정상 종료면 바로 회의록을 만든다.
    if (!hasFinalSegments(transcriptRef.current)) {
      if (result.ok) setNotice({ text: MEETING_MESSAGES.emptyTranscript, tone: "info" });
      setPhase("stopped");
      return;
    }
    if (result.ok) void generateNotes(target);
    else setPhase("stopped");
  }, [generateNotes, releaseCapture]);

  const start = useCallback(async () => {
    if (phase !== "idle") return;
    if (!isMicrophoneCaptureSupported()) {
      setNotice({ text: MEETING_MESSAGES.unsupported, tone: "error" });
      return;
    }
    setPhase("starting");
    setNotice(null);
    setNotes(null);
    setPreview(null);
    setMeeting(null);
    setCanRequestPartial(false);
    setTranscript(EMPTY_TRANSCRIPT);
    const attempt = ++startAttemptRef.current;
    const isAbandoned = () => !isMountedRef.current || attempt !== startAttemptRef.current;
    // 연결 전 음성도 잃지 않도록 마이크를 먼저 열고, 세션이 준비되기 전 조각은 세션이 모아 둔다.
    let session: LiveSession | null = null;
    const early: { pcm: Uint8Array; rms: number }[] = [];
    try {
      microphoneRef.current = await startMicrophoneCapture((pcm, rms) => {
        if (session) session.sendAudio(pcm, rms);
        else early.push({ pcm, rms });
      });
    } catch (error) {
      if (isAbandoned()) return;
      setNotice({ text: describeMicrophoneError(error), tone: "error" });
      setPhase("idle");
      return;
    }
    if (isAbandoned()) {
      releaseCapture();
      return;
    }
    let created: MeetingResponse;
    try {
      created = await createMeeting({ documentId });
    } catch (error) {
      releaseCapture();
      if (isAbandoned()) return;
      setNotice({ text: getErrorMessage(error, MEETING_ERROR_MESSAGES.createFailed), tone: "error" });
      setPhase("idle");
      return;
    }
    if (isAbandoned()) {
      releaseCapture();
      return;
    }
    setMeeting(created);
    session = createLiveSession({
      issueTicket: () => issueMeetingLiveTicket(created.meeting_id),
      openSocket: (ticket) => openLiveSocket(created.meeting_id, ticket),
      onReady: () => {
        if (!isMountedRef.current) return;
        setPhase((current) => (current === "finishing" ? current : "recording"));
        setNotice(null);
      },
      onTranscriptEvent: (event) => {
        if (isMountedRef.current) setTranscript((current) => applyLiveEvent(current, event));
      },
      onReconnecting: () => {
        if (isMountedRef.current) setPhase((current) => (current === "finishing" ? current : "reconnecting"));
      },
      onStopped: (result) => handleStopped(created, result)
    });
    sessionRef.current = session;
    for (const chunk of early.splice(0)) session.sendAudio(chunk.pcm, chunk.rms);
    void session.start();
  }, [documentId, handleStopped, phase, releaseCapture]);

  /** 녹음을 멈춘다. 남은 구간을 저장하면(finished) 회의록을 만든다. */
  const stop = useCallback(() => {
    const session = sessionRef.current;
    releaseCapture();
    if (!session) {
      // 회의를 만들기 전이면 시작을 버린다. 서버에 남는 것이 없거나 빈 회의 하나다.
      startAttemptRef.current += 1;
      setPhase((current) => (current === "starting" ? "idle" : current));
      return;
    }
    setPhase("finishing");
    session.finish();
  }, [releaseCapture]);

  // 회의록 생성은 비동기다. ready·failed가 될 때까지 조회한다(서버가 30분 넘게 걸리면 failed로 바꾼다).
  useEffect(() => {
    if (phase !== "generating" || !meeting) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const latest = await fetchMeetingNotes(meeting.meeting_id);
        if (cancelled || latest.status === "generating") return;
        setNotes(latest);
        if (latest.status === "failed") {
          setNotice({ text: describeMeetingNotesError(latest.error_code), tone: "error" });
          setPhase("stopped");
        } else {
          setPhase(latest.status === "applied" ? "applied" : "ready");
        }
      } catch {
        // 일시적인 조회 실패는 다음 주기에 다시 묻는다.
      }
    }, NOTES_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [meeting, phase]);

  const cancelNotes = useCallback(async () => {
    if (!meeting || phase !== "generating") return;
    try {
      const cancelled = await cancelMeetingNotes(meeting.meeting_id);
      setNotes(cancelled);
      setNotice({ text: MEETING_MESSAGES.notesCancelled, tone: "info" });
      setPhase("stopped");
    } catch (error) {
      // 이미 끝났으면(409 MEETING_NOTES_NOT_GENERATING) 다음 조회가 결과를 보여 준다.
      setNotice({ text: getErrorMessage(error, MEETING_ERROR_MESSAGES.notesCancelFailed), tone: "error" });
    }
  }, [meeting, phase]);

  const finishSave = useCallback(async (saved: MeetingNotesResponse) => {
    setNotes(saved);
    setPreview(null);
    setPhase("applied");
    setNotice({ text: MEETING_MESSAGES.saved, tone: "info" });
    if (saved.applied) await Promise.resolve(onDocumentSavedRef.current?.(saved.applied.document_id)).catch(() => undefined);
  }, []);

  const saveAsNewDocument = useCallback(async () => {
    if (!meeting || !notes || phase !== "ready") return;
    setPhase("saving");
    setNotice(null);
    try {
      await finishSave(await applyMeetingNotes(meeting.meeting_id, notes.version, { mode: "create" }));
    } catch (error) {
      setNotice({ text: describeNotesSaveError(error, MEETING_ERROR_MESSAGES.applyFailed), tone: "error" });
      setPhase("ready");
    }
  }, [finishSave, meeting, notes, phase]);

  const previewAppend = useCallback(async () => {
    if (!meeting?.document_id || !notes || phase !== "ready") return;
    setPhase("saving");
    setNotice(null);
    try {
      setPreview(await previewMeetingNotesAppend(meeting.meeting_id, notes.version));
      setPhase("previewing");
    } catch (error) {
      setNotice({ text: describeNotesSaveError(error, MEETING_ERROR_MESSAGES.previewFailed), tone: "error" });
      setPhase("ready");
    }
  }, [meeting, notes, phase]);

  const confirmAppend = useCallback(async () => {
    if (!meeting || !notes || !preview || phase !== "previewing") return;
    setPhase("saving");
    setNotice(null);
    try {
      await finishSave(await applyMeetingNotes(meeting.meeting_id, notes.version, {
        mode: "append",
        document_id: preview.document_id,
        base_revision: preview.base_revision
      }));
    } catch (error) {
      setPreview(null);
      setNotice({ text: describeNotesSaveError(error, MEETING_ERROR_MESSAGES.applyFailed), tone: "error" });
      setPhase("ready");
    }
  }, [finishSave, meeting, notes, phase, preview]);

  const cancelPreview = useCallback(() => {
    if (phase !== "previewing") return;
    setPreview(null);
    setPhase("ready");
  }, [phase]);

  const regenerate = useCallback((allowPartial = false) => {
    if (!meeting || (phase !== "ready" && phase !== "stopped")) return;
    void generateNotes(meeting, allowPartial);
  }, [generateNotes, meeting, phase]);

  /** 회의 화면을 닫고 채팅으로 돌아간다. 회의·전사·초안은 서버에 남는다. */
  const close = useCallback(() => {
    if (phase === "idle" || phase === "starting" || phase === "recording" || phase === "reconnecting" || phase === "finishing" || phase === "saving") return;
    setPhase("idle");
    setMeeting(null);
    setNotes(null);
    setPreview(null);
    setNotice(null);
    setCanRequestPartial(false);
    setTranscript(EMPTY_TRANSCRIPT);
  }, [phase]);

  return {
    phase,
    meeting,
    transcript,
    notes,
    preview,
    notice,
    canRequestPartial,
    hasTranscript: hasFinalSegments(transcript),
    start,
    stop,
    cancelNotes,
    saveAsNewDocument,
    previewAppend,
    confirmAppend,
    cancelPreview,
    regenerate,
    close
  };
}

export type MeetingSessionState = ReturnType<typeof useMeetingSession>;
