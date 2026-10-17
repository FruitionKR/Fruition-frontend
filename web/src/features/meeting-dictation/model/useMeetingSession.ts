import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyMeetingNotes,
  cancelMeetingNotes,
  cancelMeetingTranscription,
  checkRecordingFile,
  createMeeting,
  deleteMeeting,
  fetchMeeting,
  fetchMeetingNotes,
  issueMeetingLiveTicket,
  MEETING_ERROR_MESSAGES,
  meetingNameFromFile,
  previewMeetingNotesAppend,
  requestMeetingNotes,
  uploadMeetingRecording,
  type MeetingAppendPreviewResponse,
  type MeetingNotesResponse,
  type MeetingResponse,
  type MeetingSource
} from "@/entities/meeting";
import { getDocumentTransport } from "@/shared/api/documentTransport";
import { describeMeetingNotesError, describeMeetingTranscriptionFailure } from "@/shared/lib/aiErrorCodes";
import { ApiError, getErrorMessage } from "@/shared/lib/apiErrors";
import { startSerialPolling } from "@/shared/lib/serialPolling";
import { describeMicrophoneError } from "@/features/agent-chat/lib/dictation";
import { buildLiveSocketUrl } from "../lib/liveProtocol";
import { applyLiveEvent, EMPTY_TRANSCRIPT, hasFinalSegments, transcriptFromSegments, type LiveTranscript } from "../lib/liveTranscript";
import {
  canCloseMeetingInPhase,
  canDeleteMeetingInPhase,
  describeNotesRequestError,
  describeNotesSaveError,
  describeRecordingError,
  MEETING_MESSAGES,
  shouldConfirmLeavingPhase,
  type MeetingPhase
} from "../lib/meetingNotesFlow";
import { resumedMeetingView, shouldLoadNotesOnResume } from "../lib/meetingResume";
import { createLiveSession, type LiveSession, type LiveSocket, type LiveStopResult } from "./liveSession";
import { isMicrophoneCaptureSupported, startMicrophoneCapture, type MicrophoneCapture } from "./microphoneCapture";

const NOTES_POLL_MS = 2_000;
// 녹음 파일 전사는 몇 분 걸릴 수 있다. 결과는 회의 조회로 기다린다(document는 자동 시간 초과 전환이 없다).
const TRANSCRIPTION_POLL_MS = 3_000;
// finished 직후 서버가 받아쓰기 잠금을 늦게 풀면 회의록 요청이 409 MEETING_LIVE_IN_USE를 받는다. 잠시 뒤 다시 보낸다.
const LIVE_RELEASE_RETRIES = 3;
const LIVE_RELEASE_DELAY_MS = 1_500;

export type MeetingNotice = { text: string; tone: "error" | "info" };

async function openLiveSocket(meetingId: string, ticket: string): Promise<LiveSocket> {
  const transport = await getDocumentTransport();
  return new WebSocket(buildLiveSocketUrl(transport.origin, window.location.origin, meetingId, ticket)) as unknown as LiveSocket;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 녹음 파일 회의가 원본을 (다시) 받을 수 있는 상태. 올리기 전이거나 실패·취소된 뒤다. */
function acceptsRecording(meeting: MeetingResponse | null): boolean {
  return meeting?.source === "upload" && (meeting.status === "awaiting_upload" || meeting.status === "failed");
}

/**
 * 채팅 패널의 회의 받아쓰기(#148): 회의 생성 → 마이크·WebSocket 실시간 전사 → 멈추면 회의록 생성(비동기, 조회로 대기)
 * → 새 문서로 저장하거나 회의를 시작한 문서 끝에 추가(미리보기 → 저장).
 * documentId는 열린 Markdown 문서다. 있으면 회의록을 그 문서 끝에 추가할 대상으로 기억한다.
 */
export function useMeetingSession({
  documentId,
  onDocumentSaved,
  onMeetingDeleted
}: {
  documentId: string | null;
  onDocumentSaved?: (documentId: string) => Promise<void> | void;
  /** 회의를 지워 회의 화면이 닫힌 뒤 부른다(안내·포커스 이동). */
  onMeetingDeleted?: () => void;
}) {
  const [phase, setPhase] = useState<MeetingPhase>("idle");
  const [meeting, setMeeting] = useState<MeetingResponse | null>(null);
  const [transcript, setTranscript] = useState<LiveTranscript>(EMPTY_TRANSCRIPT);
  const [notes, setNotes] = useState<MeetingNotesResponse | null>(null);
  const [preview, setPreview] = useState<MeetingAppendPreviewResponse | null>(null);
  const [notice, setNotice] = useState<MeetingNotice | null>(null);
  const [canRequestPartial, setCanRequestPartial] = useState(false);
  // 실시간 받아쓰기(live)인지 녹음 파일 전사(upload)인지. 회의를 만들기 전 실패에도 화면 문구를 맞추려고 따로 둔다.
  const [source, setSource] = useState<MeetingSource>("live");
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  // 삭제가 실패하면 삭제 전 단계로 돌아간다.
  const phaseBeforeDeleteRef = useRef<MeetingPhase>("stopped");
  const sessionRef = useRef<LiveSession | null>(null);
  // 시작 중(마이크 권한·회의 생성 대기)에 멈추거나 화면을 떠나면 값이 바뀌어 진행 중이던 시작을 버린다.
  const startAttemptRef = useRef(0);
  const microphoneRef = useRef<MicrophoneCapture | null>(null);
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const isMountedRef = useRef(true);
  const onDocumentSavedRef = useRef(onDocumentSaved);
  onDocumentSavedRef.current = onDocumentSaved;
  const onMeetingDeletedRef = useRef(onMeetingDeleted);
  onMeetingDeletedRef.current = onMeetingDeleted;
  // 회의 화면을 닫거나 다른 회의를 열 때마다 바뀐다. 닫은 뒤 늦게 끝난 요청(회의록 생성·회의 불러오기)이 화면을 다시 열지 않게 한다.
  const viewRunRef = useRef(0);

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
      // 화면을 떠나면 올리던 녹음 파일도 끊는다. 회의는 awaiting_upload로 남는다.
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
    };
  }, []);

  const generateNotes = useCallback(async (target: MeetingResponse, allowPartial = false) => {
    setPhase("generating");
    setNotice(null);
    setCanRequestPartial(false);
    // 같은 생성 요청의 재시도는 같은 키로 보낸다(같은 버전을 돌려받는다).
    const key = crypto.randomUUID();
    const viewRun = viewRunRef.current;
    const isAbandoned = () => !isMountedRef.current || viewRun !== viewRunRef.current;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await requestMeetingNotes(target.meeting_id, { allowPartial, key });
        if (isAbandoned()) return;
        setNotes(response);
        if (response.status === "ready") setPhase("ready");
        else if (response.status === "failed") {
          setNotice({ text: describeMeetingNotesError(response.error_code), tone: "error" });
          setPhase("stopped");
        }
        return;
      } catch (error) {
        if (isAbandoned()) return;
        const described = describeNotesRequestError(error);
        if (described.liveStillOpen && attempt < LIVE_RELEASE_RETRIES) {
          await wait(LIVE_RELEASE_DELAY_MS);
          if (isAbandoned()) return;
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
    setSource("live");
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

  /** 녹음 파일 회의의 서버 상태를 화면 단계로 옮긴다. 전사가 끝났으면(open) 받아쓰기를 멈춘 때처럼 바로 회의록을 만든다. */
  const applyRecordingMeeting = useCallback((target: MeetingResponse, options: { cancelled?: boolean } = {}) => {
    setMeeting(target);
    if (target.status === "transcribing") {
      setPhase("transcribing");
      return;
    }
    if (target.status === "failed") {
      setNotice({ text: describeMeetingTranscriptionFailure(target.error), tone: options.cancelled ? "info" : "error" });
      setPhase("stopped");
      return;
    }
    if (target.status !== "open") {
      setPhase("stopped");
      return;
    }
    const transcribed = transcriptFromSegments(target.segments);
    setTranscript(transcribed);
    if (!hasFinalSegments(transcribed)) {
      setNotice({ text: MEETING_MESSAGES.emptyRecordingTranscript, tone: "info" });
      setPhase("stopped");
      return;
    }
    void generateNotes(target);
  }, [generateNotes]);

  // 전사 중인 회의의 끝(open·failed)을 한 번만 반영한다. 조회와 전사 취소(409 뒤 재조회)가 같은 끝을 따로 받아도
  // 먼저 온 쪽만 회의록 생성으로 넘어간다. 값은 끝을 반영할 때마다 바뀌어 늦게 온 쪽을 버린다.
  const transcriptionRunRef = useRef(0);
  const settleTranscription = useCallback((run: number, target: MeetingResponse, options?: { cancelled?: boolean }) => {
    if (transcriptionRunRef.current !== run) return;
    transcriptionRunRef.current += 1;
    applyRecordingMeeting(target, options);
  }, [applyRecordingMeeting]);

  /**
   * 녹음 파일로 전사한다: 녹음 파일 회의 생성(upload) → S3 직접 multipart 업로드 → 확정하면 전사 시작(transcribing).
   * 실패·취소된 녹음 파일 회의를 보고 있으면 새 회의 대신 그 회의에 다시 올린다.
   */
  const uploadRecording = useCallback(async (file: File) => {
    const reusable = phase === "stopped" && acceptsRecording(meeting) ? meeting : null;
    const startsFresh = phase === "idle" || (phase === "stopped" && source === "upload" && meeting === null);
    if (!reusable && !startsFresh) return;
    setSource("upload");
    setNotes(null);
    setPreview(null);
    setCanRequestPartial(false);
    setTranscript(EMPTY_TRANSCRIPT);
    if (!reusable) setMeeting(null);
    const checked = checkRecordingFile(file);
    if (!checked.ok) {
      setNotice({ text: checked.message, tone: "error" });
      setPhase("stopped");
      return;
    }
    setNotice(null);
    setUploadPercent(0);
    setPhase("uploading");
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    let target = reusable;
    try {
      if (!target) {
        target = await createMeeting({ source: "upload", documentId, displayName: meetingNameFromFile(file.name) || undefined });
        if (!isMountedRef.current) return;
        setMeeting(target);
      }
      const uploaded = await uploadMeetingRecording(target.meeting_id, file, checked.contentType, {
        signal: controller.signal,
        onProgress: (sent, total) => {
          if (isMountedRef.current) setUploadPercent(Math.min(100, Math.floor((sent / total) * 100)));
        }
      });
      if (!isMountedRef.current) return;
      applyRecordingMeeting(uploaded);
      // complete 중에 취소했는데 전사 취소까지 실패했다. 전사(과금)가 돌고 있음을 알리고 전사 취소를 받는다.
      if (controller.signal.aborted && uploaded.status === "transcribing") {
        setNotice({ text: MEETING_MESSAGES.uploadCancelTooLate, tone: "error" });
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      if (controller.signal.aborted) {
        // 사용자가 취소했다. 이번에 만든 빈 회의는 지워 남기지 않는다(실패한 회의에 다시 올리던 중이면 그 회의는 둔다).
        if (target && !reusable) await deleteMeeting(target.meeting_id).catch(() => undefined);
        if (!isMountedRef.current) return;
        if (!reusable) setMeeting(null);
        setNotice({ text: MEETING_MESSAGES.uploadCancelled, tone: "info" });
        setPhase("stopped");
        return;
      }
      setNotice({ text: describeRecordingError(error, MEETING_ERROR_MESSAGES.uploadFailed), tone: "error" });
      setPhase("stopped");
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      if (isMountedRef.current) setUploadPercent(null);
    }
  }, [applyRecordingMeeting, documentId, meeting, phase, source]);

  /** 올리는 중인 녹음 파일 전송을 끊는다. 결과 정리는 uploadRecording이 한다. */
  const cancelUpload = useCallback(() => {
    uploadAbortRef.current?.abort();
  }, []);

  // 녹음 파일 조각을 올리는 중에 탭을 닫거나 새로고침하면 업로드를 이어 갈 수 없으므로 브라우저 확인을 받는다.
  // 전사 중에는 묻지 않는다. 전사는 서버에서 이어지고 회의 목록에서 다시 열 수 있다.
  const confirmsLeaving = shouldConfirmLeavingPhase(phase);
  useEffect(() => {
    if (!confirmsLeaving) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // 일부 브라우저(구형 Safari 등)는 returnValue가 있어야 확인창을 띄운다.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [confirmsLeaving]);

  // 녹음 파일 전사는 비동기다. transcribing이 끝날 때까지 회의를 조회한다.
  // 앞 조회가 끝난 뒤에 다음을 예약한다. 겹치면 open을 두 번 받아 회의록 생성을 두 번 보내고 두 번째가 409 MEETING_NOTES_BUSY가 된다.
  useEffect(() => {
    if (phase !== "transcribing" || !meeting) return;
    let cancelled = false;
    const meetingId = meeting.meeting_id;
    const run = transcriptionRunRef.current;
    const stopPolling = startSerialPolling(async () => {
      try {
        const latest = await fetchMeeting(meetingId);
        if (cancelled) return true;
        if (latest.status === "transcribing") return false;
        settleTranscription(run, latest);
        return true;
      } catch (error) {
        if (cancelled) return true;
        // 다른 탭에서 지웠으면 더 기다릴 회의가 없다. 그 밖의 일시적인 조회 실패는 다음 주기에 다시 묻는다.
        if (error instanceof ApiError && error.status === 404) {
          setNotice({ text: describeRecordingError(error, MEETING_ERROR_MESSAGES.loadFailed), tone: "error" });
          setMeeting(null);
          setPhase("stopped");
          return true;
        }
        return false;
      }
    }, TRANSCRIPTION_POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [meeting, phase, settleTranscription]);

  const cancelTranscription = useCallback(async () => {
    if (!meeting || phase !== "transcribing") return;
    const meetingId = meeting.meeting_id;
    const run = transcriptionRunRef.current;
    try {
      const cancelled = await cancelMeetingTranscription(meetingId);
      if (isMountedRef.current) settleTranscription(run, cancelled, { cancelled: true });
    } catch (error) {
      if (!isMountedRef.current) return;
      // 그사이 전사가 끝났으면(409 MEETING_NOT_TRANSCRIBING) 결과를 바로 보여 준다.
      if (error instanceof ApiError && error.code === "MEETING_NOT_TRANSCRIBING") {
        const latest = await fetchMeeting(meetingId).catch(() => null);
        if (latest && isMountedRef.current) {
          settleTranscription(run, latest);
          return;
        }
      }
      setNotice({ text: describeRecordingError(error, MEETING_ERROR_MESSAGES.transcriptionCancelFailed), tone: "error" });
    }
  }, [meeting, phase, settleTranscription]);

  const resetView = useCallback(() => {
    viewRunRef.current += 1;
    // 진행 중이던 전사 취소 응답이 닫은 화면을 다시 열지 않게 한다.
    transcriptionRunRef.current += 1;
    setPhase("idle");
    setMeeting(null);
    setNotes(null);
    setPreview(null);
    setNotice(null);
    setCanRequestPartial(false);
    setTranscript(EMPTY_TRANSCRIPT);
    setSource("live");
  }, []);

  /** 회의·전사·회의록 초안·녹음 원본을 지우고 회의 화면을 닫는다. 이미 문서로 저장한 회의록은 남는다. */
  const deleteCurrentMeeting = useCallback(async () => {
    if (!meeting || !canDeleteMeetingInPhase(phase)) return;
    phaseBeforeDeleteRef.current = phase;
    setPhase("deleting");
    setNotice(null);
    try {
      await deleteMeeting(meeting.meeting_id);
    } catch (error) {
      if (!isMountedRef.current) return;
      // 이미 지워졌으면(404) 지운 것과 같다.
      if (!(error instanceof ApiError && error.status === 404)) {
        setNotice({ text: describeRecordingError(error, MEETING_ERROR_MESSAGES.deleteFailed), tone: "error" });
        setPhase(phaseBeforeDeleteRef.current);
        return;
      }
    }
    if (!isMountedRef.current) return;
    resetView();
    onMeetingDeletedRef.current?.();
  }, [meeting, phase, resetView]);

  const cancelNotes = useCallback(async () => {
    if (!meeting || phase !== "generating") return;
    const viewRun = viewRunRef.current;
    try {
      const cancelled = await cancelMeetingNotes(meeting.meeting_id);
      if (!isMountedRef.current || viewRun !== viewRunRef.current) return;
      setNotes(cancelled);
      setNotice({ text: MEETING_MESSAGES.notesCancelled, tone: "info" });
      setPhase("stopped");
    } catch (error) {
      if (!isMountedRef.current || viewRun !== viewRunRef.current) return;
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

  /**
   * 회의 화면을 닫고 채팅(또는 회의 목록)으로 돌아간다. 회의·전사·초안은 서버에 남는다.
   * 전사·회의록 생성 중에도 닫을 수 있다. 서버에서 이어지고 회의 목록에서 다시 열면 진행 상태부터 보여 준다.
   */
  const close = useCallback(() => {
    if (!canCloseMeetingInPhase(phase)) return;
    resetView();
  }, [phase, resetView]);

  /**
   * 회의 목록에서 고른 회의를 다시 연다(진행 중인 회의 이어 보기). 회의와 최신 회의록 초안을 받아
   * 상태에 맞는 화면(전사 대기·실패 안내·받아쓴 내용·회의록 대기·회의록·저장됨)으로 연다. 녹음이 있으면 재생도 보인다.
   * 불러오지 못하면 화면을 열지 않고 오류 문구를 돌려준다(목록이 보여 준다).
   */
  const resume = useCallback(async (meetingId: string): Promise<string | null> => {
    if (phase !== "idle") return null;
    viewRunRef.current += 1;
    const viewRun = viewRunRef.current;
    const isAbandoned = () => !isMountedRef.current || viewRun !== viewRunRef.current;
    setNotes(null);
    setPreview(null);
    setNotice(null);
    setCanRequestPartial(false);
    setTranscript(EMPTY_TRANSCRIPT);
    setMeeting(null);
    setPhase("opening");
    try {
      const target = await fetchMeeting(meetingId);
      const latestNotes = shouldLoadNotesOnResume(target)
        ? await fetchMeetingNotes(meetingId).catch((error: unknown) => {
          // 회의록 초안이 아직 없으면 404다.
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        })
        : null;
      if (isAbandoned()) return null;
      const view = resumedMeetingView(target, latestNotes);
      setSource(target.source);
      setMeeting(target);
      setNotes(latestNotes);
      setTranscript(transcriptFromSegments(target.segments));
      setNotice(view.notice);
      setPhase(view.phase);
      return null;
    } catch (error) {
      if (isAbandoned()) return null;
      setPhase("idle");
      return describeRecordingError(error, MEETING_ERROR_MESSAGES.loadFailed);
    }
  }, [phase]);

  return {
    phase,
    meeting,
    transcript,
    notes,
    preview,
    notice,
    canRequestPartial,
    source,
    uploadPercent,
    hasTranscript: hasFinalSegments(transcript),
    /** 지금 녹음 파일을 고르면 받을 수 있는지(새 회의 또는 실패한 녹음 파일 회의에 다시 올리기) */
    canUploadRecording: phase === "idle" || (phase === "stopped" && source === "upload" && (meeting === null || acceptsRecording(meeting))),
    start,
    stop,
    uploadRecording,
    cancelUpload,
    cancelTranscription,
    deleteMeeting: deleteCurrentMeeting,
    cancelNotes,
    saveAsNewDocument,
    previewAppend,
    confirmAppend,
    cancelPreview,
    regenerate,
    close,
    resume
  };
}

export type MeetingSessionState = ReturnType<typeof useMeetingSession>;
