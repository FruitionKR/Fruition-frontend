import { useEffect, useRef, useState } from "react";
import { NoteContentConflictError, saveNoteDraft } from "../api/note";
import { MAX_IMAGES_PER_SAVE, pendingImages, substituteAttachmentPaths, type SavedAttachment } from "./imageAttachments";
import { composeEditableNoteMarkdown } from "@/entities/document/lib/note";
import { getErrorMessage, SessionExpiredError } from "@/shared/lib/errors";
import type { NoteSaveStatus } from "@/entities/tree/model/tree";
import {
  applyRequiredAgentSource,
  mergePendingNoteSave,
  planAgentRetryAfterFailure,
  recoverPendingNoteSaveAfterAgentFailure,
  selectDetachedSaveCandidate,
  type PendingNoteSave
} from "./pendingSave";
import { trackPendingDocumentSave } from "./pendingDocumentSave";

/** 저장을 영구히 멈추는 사유. 그대로 NoteSaveStatus로 쓰인다. */
export type NoteSaveBlock = "conflict" | "lock-lost" | "session-expired";

export type DetachedNoteSaveResult =
  | { success: true }
  | { success: false; error: unknown };

const AUTOSAVE_DELAY_MS = 800;
// AI 편집은 에디터에 이미 반영된 뒤라, 저장에 실패하면 사용자가 다시 편집하지 않아도 스스로 다시 보낸다.
const AGENT_RETRY_MAX_ATTEMPTS = 3;
const AGENT_RETRY_BASE_MS = 1000;

export function useNoteAutosave({
  documentId,
  marker,
  initialVersion,
  onDetachedSaveComplete,
  onAttachmentsSaved
}: {
  documentId: string;
  marker: string;
  initialVersion: number;
  onDetachedSaveComplete?: (result: DetachedNoteSaveResult) => void;
  /** 이미지 placeholder가 서버 관리 경로로 치환됐을 때. 편집기 본문의 placeholder를 바꿔 넣는 데 쓴다. */
  onAttachmentsSaved?: (saved: SavedAttachment[]) => void;
}) {
  const [status, setStatus] = useState<NoteSaveStatus>("saved");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [contentVersion, setContentVersion] = useState(initialVersion);
  const versionRef = useRef(initialVersion);
  const onAttachmentsSavedRef = useRef(onAttachmentsSaved);
  onAttachmentsSavedRef.current = onAttachmentsSaved;
  // 이미 저장된 placeholder → 관리 경로. 사용자가 치환 전에 더 입력해도 같은 파일을 다시 올리지 않는다.
  const savedAttachmentPathsRef = useRef(new Map<string, string>());
  const revisionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledSaveRef = useRef<PendingNoteSave | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef<PendingNoteSave | null>(null);
  // 더 이상 서버에 써서는 안 되는 이유. conflict(버전 충돌)·lock-lost(편집 잠금 상실)·session-expired(세션 만료)를 같은 방식으로 막는다.
  const saveBlockRef = useRef<NoteSaveBlock | null>(null);
  const agentRetryRequiredRef = useRef(false);
  const agentRetryApplyOperationIdRef = useRef<string | undefined>(undefined);
  const agentRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentRetryCandidateRef = useRef<PendingNoteSave | null>(null);
  const agentRetryAttemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const flushSaveRef = useRef<(candidate: PendingNoteSave) => Promise<boolean>>(async () => false);
  const onDetachedSaveCompleteRef = useRef(onDetachedSaveComplete);
  onDetachedSaveCompleteRef.current = onDetachedSaveComplete;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (agentRetryTimerRef.current) clearTimeout(agentRetryTimerRef.current);
      agentRetryTimerRef.current = null;

      // 디바운스·AI 재시도 대기 중 이동해도 마지막 편집분을 잃지 않도록 즉시 저장한다.
      const scheduled = selectDetachedSaveCandidate(
        scheduledSaveRef.current,
        agentRetryCandidateRef.current
      );
      scheduledSaveRef.current = null;
      agentRetryCandidateRef.current = null;
      if (scheduled && !saveBlockRef.current) void flushSaveRef.current(scheduled);
    };
  }, []);

  function cancelAgentRetry() {
    if (agentRetryTimerRef.current) clearTimeout(agentRetryTimerRef.current);
    agentRetryTimerRef.current = null;
    agentRetryCandidateRef.current = null;
  }

  function scheduleAgentRetry(
    candidate: PendingNoteSave,
    recovered: { pending: PendingNoteSave | null; retryRequired: boolean }
  ) {
    if (!mountedRef.current) return;
    const plan = planAgentRetryAfterFailure(
      recovered,
      agentRetryAttemptsRef.current,
      AGENT_RETRY_MAX_ATTEMPTS,
      AGENT_RETRY_BASE_MS
    );
    agentRetryAttemptsRef.current = plan.attempts;
    if (!plan.shouldRetry) {
      agentRetryCandidateRef.current = null;
      return;
    }
    cancelAgentRetry();
    agentRetryCandidateRef.current = candidate;
    agentRetryTimerRef.current = setTimeout(() => {
      agentRetryTimerRef.current = null;
      agentRetryCandidateRef.current = null;
      if (saveBlockRef.current) return;
      void trackedFlushSave(candidate);
    }, plan.delayMs);
  }

  async function flushSave(candidate: PendingNoteSave): Promise<boolean> {
    const saveCandidate = applyRequiredAgentSource(
      candidate,
      agentRetryRequiredRef.current,
      agentRetryApplyOperationIdRef.current
    );
    if (saveBlockRef.current) return false;
    if (saveInFlightRef.current) {
      pendingSaveRef.current = mergePendingNoteSave(pendingSaveRef.current, saveCandidate);
      return true;
    }

    saveInFlightRef.current = true;
    if (mountedRef.current) {
      setStatus("saving");
      setErrorMessage(null);
    }
    try {
      if (saveCandidate.source === "agent") {
        agentRetryApplyOperationIdRef.current = saveCandidate.applyOperationId;
      }
      const markdownToSave = substituteAttachmentPaths(saveCandidate.markdown, savedAttachmentPathsRef.current);
      const attachments = pendingImages.collect(markdownToSave);
      if (attachments.length > MAX_IMAGES_PER_SAVE) {
        throw new Error(`한 번에 저장할 수 있는 새 이미지는 ${MAX_IMAGES_PER_SAVE}개까지입니다.`);
      }
      const saved = await saveNoteDraft(
        documentId,
        markdownToSave,
        versionRef.current,
        saveCandidate.source,
        saveCandidate.applyOperationId,
        attachments
      );
      if (saved.attachments.length > 0) {
        // 보관소의 파일은 지우지 않는다. 사용자가 undo로 placeholder 노드를 되살리면 다음 저장에서 같은 파일을 다시 올려 해결된다.
        // 대신 매핑을 기억해 두어 같은 placeholder가 그대로 남아 있으면 재업로드 없이 관리 경로로 바꾼다.
        saved.attachments.forEach((entry) => savedAttachmentPathsRef.current.set(entry.attachment_id.toLowerCase(), entry.content_path));
        onAttachmentsSavedRef.current?.(saved.attachments);
      }
      versionRef.current = saved.content_version;
      if (mountedRef.current) setContentVersion(saved.content_version);
      if (saveCandidate.source === "agent") {
        agentRetryApplyOperationIdRef.current = undefined;
        agentRetryRequiredRef.current = false;
        agentRetryAttemptsRef.current = 0;
        cancelAgentRetry();
      }
      if (mountedRef.current) {
        setStatus(saveCandidate.revision === revisionRef.current ? "saved" : "dirty");
      } else {
        onDetachedSaveCompleteRef.current?.({ success: true });
      }
      return true;
    } catch (error) {
      if (error instanceof NoteContentConflictError) {
        saveBlockRef.current = "conflict";
        cancelAgentRetry();
        if (mountedRef.current) setStatus("conflict");
      } else if (error instanceof SessionExpiredError) {
        // 세션이 끝난 뒤의 저장은 몇 번을 보내도 실패한다. 저장된 척하지 않고 입력을 멈춘다.
        saveBlockRef.current = "session-expired";
        cancelAgentRetry();
        if (mountedRef.current) setStatus("session-expired");
      } else {
        if (saveCandidate.source === "agent") {
          const recovery = recoverPendingNoteSaveAfterAgentFailure(pendingSaveRef.current);
          pendingSaveRef.current = recovery.pending;
          agentRetryRequiredRef.current = recovery.retryRequired;
          scheduleAgentRetry(saveCandidate, recovery);
        }
        if (mountedRef.current) setStatus("error");
      }
      if (mountedRef.current) {
        setErrorMessage(getErrorMessage(error, "노트를 저장하지 못했습니다."));
      } else {
        onDetachedSaveCompleteRef.current?.({ success: false, error });
      }
      return false;
    } finally {
      saveInFlightRef.current = false;
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending && !saveBlockRef.current) void trackedFlushSave(pending);
    }
  }

  function trackedFlushSave(candidate: PendingNoteSave): Promise<boolean> {
    const save = flushSave(candidate);
    trackPendingDocumentSave(documentId, save);
    return save;
  }
  flushSaveRef.current = trackedFlushSave;

  /**
   * 저장을 영구히 멈춘다. useEditLock이 heartbeat 409(잠금 상실)를 받으면 호출한다.
   * 예약된 디바운스·AI 재시도까지 버려 잠금을 잃은 뒤의 편집이 남의 본문을 덮어쓰지 않게 한다.
   */
  function reportSaveBlock(block: NoteSaveBlock, message: string) {
    if (saveBlockRef.current) return;
    saveBlockRef.current = block;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    scheduledSaveRef.current = null;
    pendingSaveRef.current = null;
    cancelAgentRetry();
    if (mountedRef.current) {
      setStatus(block);
      setErrorMessage(message);
    }
  }

  function queueSave(body: string, source?: "agent", applyOperationId?: string) {
    if (saveBlockRef.current) return;
    // 새 저장이 밀린 AI 편집분을 그대로 싣고 가므로 예약된 재시도는 버린다.
    cancelAgentRetry();
    revisionRef.current += 1;
    const saveSource = source ?? (agentRetryRequiredRef.current ? "agent" : undefined);
    const candidate = {
      markdown: composeEditableNoteMarkdown(marker, body),
      revision: revisionRef.current,
      source: saveSource,
      applyOperationId: saveSource === "agent"
        ? applyOperationId ?? agentRetryApplyOperationIdRef.current
        : undefined
    };
    setStatus("dirty");
    setErrorMessage(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (source === "agent") {
      timerRef.current = null;
      scheduledSaveRef.current = null;
      void trackedFlushSave(candidate);
      return;
    }
    scheduledSaveRef.current = candidate;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const scheduled = scheduledSaveRef.current;
      scheduledSaveRef.current = null;
      if (scheduled) void trackedFlushSave(scheduled);
    }, AUTOSAVE_DELAY_MS);
  }

  /** 디바운스를 건너뛰고 즉시 저장한다 (Cmd/Ctrl+S). 성공 여부를 반환한다. */
  function saveNow(body: string): Promise<boolean> {
    if (saveBlockRef.current) return Promise.resolve(false);
    cancelAgentRetry();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    scheduledSaveRef.current = null;
    revisionRef.current += 1;
    const saveSource = agentRetryRequiredRef.current ? ("agent" as const) : undefined;
    const candidate = {
      markdown: composeEditableNoteMarkdown(marker, body),
      revision: revisionRef.current,
      source: saveSource,
      applyOperationId: saveSource === "agent" ? agentRetryApplyOperationIdRef.current : undefined
    };
    setErrorMessage(null);
    return trackedFlushSave(candidate);
  }

  return { status, errorMessage, contentVersion, queueSave, saveNow, reportSaveBlock };
}
