import { useEffect, useRef, useState } from "react";
import { fetchNoteDraft, NoteContentConflictError, saveNoteDraft, type NoteSaveMerge } from "../api/note";
import { LEGACY_CONFLICT_MESSAGE } from "./saveMerge";
import { MAX_IMAGES_PER_SAVE, pendingImages, substituteAttachmentPaths, type SavedAttachment } from "./imageAttachments";
import { composeEditableNoteMarkdown } from "@/entities/document/lib/noteMarkdown";
import { isSessionExpired } from "@/shared/lib/authSessionStorage";
import { getErrorMessage, SessionExpiredError } from "@/shared/lib/apiErrors";
import type { NoteSaveStatus } from "@/entities/tree/model/tree";
import {
  applyRequiredAgentSource,
  mergePendingNoteSave,
  planAgentRetryAfterFailure,
  recoverPendingNoteSaveAfterAgentFailure,
  selectDetachedSaveCandidate,
  type PendingNoteSave
} from "./pendingNoteSaveMerge";
import { trackPendingDocumentSave } from "./pendingDocumentSaveTracker";
import { registerDocumentSaveFlusher, waitForPendingDocumentSave } from "@/shared/lib/documentSaveBarrier";
import { isWriteForbiddenError } from "@/entities/document/lib/documentAccess";

/** 저장 403(DOCUMENT_WRITE_FORBIDDEN): 편집 중 권한이 바뀐 경우다. 서버 원문 대신 할 일을 안내한다. */
const WRITE_FORBIDDEN_SAVE_MESSAGE = "이 문서의 편집 권한이 없어 저장하지 못했습니다. 본문을 복사해 두고 소유자나 OWNER에게 편집 권한을 요청해 주세요.";

/** 저장을 영구히 멈추는 사유. 그대로 NoteSaveStatus로 쓰인다. */
type NoteSaveBlock = "lock-lost" | "session-expired";

/**
 * 서버가 다른 곳의 저장과 합쳐 저장했을 때 편집기에 알리는 내용.
 * markdown은 편집기 본문을 바꿔도 될 때만 있다(보낸 뒤 더 고친 내용이 없을 때). notify는 같은 덮어쓰기를 한 번만 알리게 한다.
 */
export type NoteServerMerge = {
  status: NoteSaveMerge["status"];
  markdown: string | null;
  notify: boolean;
};

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
  onAttachmentsSaved,
  onServerMerge,
  beforeFlush,
  autoSave = true
}: {
  documentId: string;
  marker: string;
  initialVersion: number;
  onDetachedSaveComplete?: (result: DetachedNoteSaveResult) => void;
  /** 이미지 placeholder가 서버 관리 경로로 치환됐을 때. 편집기 본문의 placeholder를 바꿔 넣는 데 쓴다. */
  onAttachmentsSaved?: (saved: SavedAttachment[]) => void;
  /** 저장 응답이 자동 병합(merged·overwritten)이거나 구 서버 409 뒤 다시 저장해 덮어썼을 때. */
  onServerMerge?: (merge: NoteServerMerge) => void;
  /** 편집기의 지연된 변경 알림보다 먼저 현재 본문을 queueSave에 동기화한다. */
  beforeFlush?: () => void;
  /**
   * 기본 설정의 자동 저장. 끄면 입력 중에는 저장하지 않고 "저장 안 됨"으로 남긴다.
   * Cmd/Ctrl+S(saveNow), 다른 문서로 이동(언마운트), AI 편집 적용은 그대로 저장한다.
   */
  autoSave?: boolean;
}) {
  const [status, setStatus] = useState<NoteSaveStatus>("saved");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [contentVersion, setContentVersion] = useState(initialVersion);
  const versionRef = useRef(initialVersion);
  const onAttachmentsSavedRef = useRef(onAttachmentsSaved);
  onAttachmentsSavedRef.current = onAttachmentsSaved;
  const onServerMergeRef = useRef(onServerMerge);
  onServerMergeRef.current = onServerMerge;
  // 이미 알린 덮어쓰기 버전. 저장 중 더 고친 본문을 다시 병합할 때 같은 안내를 거듭 띄우지 않는다.
  const notifiedOverwriteRef = useRef<number | null>(null);
  // 구 서버 409 뒤 최신 버전을 기준으로 한 번 다시 저장하는 중인지. 연달아 409면 멈추고 안내한다.
  const legacyConflictRetryRef = useRef(false);
  // 이미 저장된 placeholder → 관리 경로. 사용자가 치환 전에 더 입력해도 같은 파일을 다시 올리지 않는다.
  const savedAttachmentPathsRef = useRef(new Map<string, string>());
  const revisionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledSaveRef = useRef<PendingNoteSave | null>(null);
  // 실패했거나 디바운스·요청 대기 중인 최신 본문. 편입 전에 반드시 저장한다.
  const unsavedCandidateRef = useRef<PendingNoteSave | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef<PendingNoteSave | null>(null);
  // 더 이상 서버에 써서는 안 되는 이유. lock-lost(편집 잠금 상실)·session-expired(세션 만료)를 같은 방식으로 막는다.
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
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;
  const beforeFlushRef = useRef(beforeFlush);
  beforeFlushRef.current = beforeFlush;
  const flushPendingSaveRef = useRef(flushPendingSave);
  flushPendingSaveRef.current = flushPendingSave;

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
        scheduledSaveRef.current ?? (!saveInFlightRef.current ? unsavedCandidateRef.current : null),
        agentRetryCandidateRef.current
      );
      scheduledSaveRef.current = null;
      agentRetryCandidateRef.current = null;
      if (scheduled) {
        if (!isSaveBlocked()) void flushSaveRef.current(scheduled);
        else trackPendingDocumentSave(documentId, Promise.resolve(false));
      }
    };
  }, [documentId]);

  useEffect(() => registerDocumentSaveFlusher(documentId, () => flushPendingSaveRef.current()), [documentId]);

  /**
   * 저장을 막아야 하는지. lock-lost는 이 화면에서 풀리지 않지만,
   * session-expired는 다른 요청·탭의 재발급이나 재로그인으로 세션이 돌아오면 푼다.
   */
  function isSaveBlocked(): boolean {
    if (saveBlockRef.current === "session-expired" && !isSessionExpired()) saveBlockRef.current = null;
    return saveBlockRef.current !== null;
  }

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
    if (isSaveBlocked()) return false;
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
      // 보낸 뒤 더 고친 내용이 없으면 서버 본문이 곧 편집기 본문이 된다.
      const isLatestEdit = saveCandidate.revision === revisionRef.current && !pendingSaveRef.current;
      if (!saved.merge || isLatestEdit) {
        versionRef.current = saved.content_version;
        if (mountedRef.current) setContentVersion(saved.content_version);
      }
      // 병합됐는데 그사이 더 고쳤다면 기준 버전을 그대로 둔다. 다음 저장에서 서버가 같은 기준으로 다시 합쳐
      // 다른 곳의 변경을 잃지 않는다(편집기 본문에는 아직 그 변경이 없기 때문이다).
      const wasLegacyRetry = legacyConflictRetryRef.current;
      legacyConflictRetryRef.current = false;
      reportServerMerge(saved.merge, isLatestEdit ? saved.markdown : null, wasLegacyRetry);
      if (unsavedCandidateRef.current?.revision === saveCandidate.revision) unsavedCandidateRef.current = null;
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
        // 자동 병합 이전 서버의 409. 저장을 막지 않고 최신 버전을 기준으로 지금 본문을 한 번 다시 보낸다.
        // 덮인 서버 본문은 버전 기록에 남는다. 다시 보내도 409면 멈추고 다음 편집·Cmd/Ctrl+S를 기다린다.
        const latestVersion = await fetchNoteDraft(documentId)
          .then((draft) => draft?.content_version ?? error.currentRevision, () => error.currentRevision);
        if (latestVersion !== null) {
          versionRef.current = latestVersion;
          if (mountedRef.current) setContentVersion(latestVersion);
        }
        if (!legacyConflictRetryRef.current && latestVersion !== null) {
          legacyConflictRetryRef.current = true;
          // 그사이 더 고친 본문(pending)이 있으면 그쪽이 최신이므로 그대로 둔다.
          if (!pendingSaveRef.current) pendingSaveRef.current = saveCandidate;
          return false;
        }
        legacyConflictRetryRef.current = false;
        if (mountedRef.current) {
          setStatus("error");
          setErrorMessage(LEGACY_CONFLICT_MESSAGE);
        } else {
          onDetachedSaveCompleteRef.current?.({ success: false, error: new Error(LEGACY_CONFLICT_MESSAGE) });
        }
        return false;
      } else if (isWriteForbiddenError(error)) {
        // 편집 중 권한이 "보기만"으로 바뀌면 이후 저장은 모두 403이다. 저장된 척하지 않고 멈춘다.
        saveBlockRef.current = "lock-lost";
        cancelAgentRetry();
        if (mountedRef.current) setStatus("lock-lost");
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
        setErrorMessage(isWriteForbiddenError(error) ? WRITE_FORBIDDEN_SAVE_MESSAGE : getErrorMessage(error, "노트를 저장하지 못했습니다."));
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

  /** 병합 결과를 편집기에 알린다. 덮어쓰기 안내는 같은 버전에 한 번만 띄운다. */
  function reportServerMerge(merge: NoteSaveMerge | null, markdown: string | null, wasLegacyRetry: boolean) {
    if (!mountedRef.current) return;
    if (merge) {
      const isNewOverwrite = merge.status === "overwritten"
        && (merge.overwrittenVersion === null || merge.overwrittenVersion !== notifiedOverwriteRef.current);
      if (isNewOverwrite) notifiedOverwriteRef.current = merge.overwrittenVersion;
      onServerMergeRef.current?.({ status: merge.status, markdown, notify: isNewOverwrite });
      return;
    }
    // 구 서버: 409 뒤 최신 버전 기준으로 다시 저장했으면 서버 본문을 덮은 것이다. 편집기 본문은 이미 그대로다.
    if (wasLegacyRetry) onServerMergeRef.current?.({ status: "overwritten", markdown: null, notify: true });
  }

  function trackedFlushSave(candidate: PendingNoteSave): Promise<boolean> {
    const queued = saveInFlightRef.current;
    const save = flushSave(candidate);
    // 대기열에 넣었다는 응답(true)은 실제 본문 저장 성공으로 기록하지 않는다.
    if (!queued) trackPendingDocumentSave(documentId, save);
    return save;
  }
  flushSaveRef.current = trackedFlushSave;

  /** 편입은 예약된 최신 본문과 이미 진행 중인 저장 대기열을 모두 반영한 뒤 시작한다. */
  async function flushPendingSave(): Promise<boolean> {
    function clearScheduledSave() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      scheduledSaveRef.current = null;
      cancelAgentRetry();
    }
    beforeFlushRef.current?.();
    clearScheduledSave();
    await waitForPendingDocumentSave(documentId);
    while (true) {
      beforeFlushRef.current?.();
      if (!unsavedCandidateRef.current) return true;
      if (isSaveBlocked()) return false;
      clearScheduledSave();
      const saved = await trackedFlushSave(unsavedCandidateRef.current);
      // flushSave는 진행 중 요청에 밀린 본문을 이어서 저장할 수 있다.
      await waitForPendingDocumentSave(documentId);
      if (!saved && unsavedCandidateRef.current) return false;
    }
  }

  /**
   * 저장을 영구히 멈춘다. useEditLock이 heartbeat 409(잠금 상실)를 받으면 호출한다.
   * 예약된 디바운스·AI 재시도까지 버려 잠금을 잃은 뒤의 편집이 남의 본문을 덮어쓰지 않게 한다.
   */
  function reportSaveBlock(block: NoteSaveBlock, message: string) {
    // session-expired는 세션이 돌아오면 풀리므로, 풀리지 않는 사유가 오면 덮어쓴다.
    if (saveBlockRef.current && saveBlockRef.current !== "session-expired") return;
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

  /** 디바운스 뒤 예약된 편집분을 저장한다. */
  function scheduleFlush() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const scheduled = scheduledSaveRef.current;
      scheduledSaveRef.current = null;
      if (scheduled) void trackedFlushSave(scheduled);
    }, AUTOSAVE_DELAY_MS);
  }

  // 자동 저장을 다시 켜면 그동안 쌓인 편집분을 바로 이어서 저장한다.
  useEffect(() => {
    if (autoSave && scheduledSaveRef.current && !timerRef.current) scheduleFlush();
    // scheduleFlush는 ref만 다루므로 autoSave가 바뀔 때만 다시 확인한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave]);

  // 자동 저장을 끈 채 저장하지 않은 편집분이 있으면 탭을 닫기 전에 브라우저가 묻는다.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (autoSaveRef.current || !unsavedCandidateRef.current) return;
      event.preventDefault();
      // 일부 브라우저(구형 Safari 등)는 returnValue가 있어야 확인창을 띄운다.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  function queueSave(body: string, source?: "agent", applyOperationId?: string) {
    if (isSaveBlocked()) return;
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
    unsavedCandidateRef.current = candidate;
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
    if (!autoSaveRef.current) {
      timerRef.current = null;
      return;
    }
    scheduleFlush();
  }

  /** 디바운스를 건너뛰고 즉시 저장한다 (Cmd/Ctrl+S). 성공 여부를 반환한다. */
  function saveNow(body: string): Promise<boolean> {
    if (isSaveBlocked()) return Promise.resolve(false);
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
    unsavedCandidateRef.current = candidate;
    setErrorMessage(null);
    return trackedFlushSave(candidate);
  }

  return { status, errorMessage, contentVersion, queueSave, saveNow, reportSaveBlock };
}
