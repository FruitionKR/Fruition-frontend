import { useEffect, useRef, useState } from "react";
import { NoteContentConflictError, saveNoteDraft } from "../api/note";
import { registerEditConflict } from "../api/editConflict";
import { describeConflictRegistration } from "./editConflict";
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
import { isWriteForbiddenError } from "@/entities/document/lib/documentAccess";

/** 저장 403(DOCUMENT_WRITE_FORBIDDEN): 편집 중 권한이 바뀐 경우다. 서버 원문 대신 할 일을 안내한다. */
const WRITE_FORBIDDEN_SAVE_MESSAGE = "이 문서의 편집 권한이 없어 저장하지 못했습니다. 본문을 복사해 두고 소유자나 OWNER에게 편집 권한을 요청해 주세요.";

/** 저장을 영구히 멈추는 사유. 그대로 NoteSaveStatus로 쓰인다. */
type NoteSaveBlock = "conflict" | "lock-lost" | "session-expired";

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
  autoSave = true
}: {
  documentId: string;
  marker: string;
  initialVersion: number;
  onDetachedSaveComplete?: (result: DetachedNoteSaveResult) => void;
  /** 이미지 placeholder가 서버 관리 경로로 치환됐을 때. 편집기 본문의 placeholder를 바꿔 넣는 데 쓴다. */
  onAttachmentsSaved?: (saved: SavedAttachment[]) => void;
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
  // 이미 저장된 placeholder → 관리 경로. 사용자가 치환 전에 더 입력해도 같은 파일을 다시 올리지 않는다.
  const savedAttachmentPathsRef = useRef(new Map<string, string>());
  const revisionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledSaveRef = useRef<PendingNoteSave | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef<PendingNoteSave | null>(null);
  // 더 이상 서버에 써서는 안 되는 이유. conflict(버전 충돌)·lock-lost(편집 잠금 상실)·session-expired(세션 만료)를 같은 방식으로 막는다.
  const saveBlockRef = useRef<NoteSaveBlock | null>(null);
  // 이 편집 세션의 충돌 등록 ID. 같은 ID 재전송은 서버가 기존 충돌을 돌려주므로 재시도해도 중복되지 않는다.
  const clientConflictIdRef = useRef(crypto.randomUUID());
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
      if (scheduled && !isSaveBlocked()) void flushSaveRef.current(scheduled);
    };
  }, []);

  /**
   * 저장을 막아야 하는지. conflict·lock-lost는 이 화면에서 풀리지 않지만,
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
    // 충돌 등록은 저장하려던 본문을 그대로 올리므로 try 바깥에서도 읽을 수 있게 둔다.
    let markdownToSave = saveCandidate.markdown;
    try {
      if (saveCandidate.source === "agent") {
        agentRetryApplyOperationIdRef.current = saveCandidate.applyOperationId;
      }
      markdownToSave = substituteAttachmentPaths(saveCandidate.markdown, savedAttachmentPathsRef.current);
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
        // 내 본문을 버리지 않고 충돌로 등록해 OWNER가 고르게 한다. 등록 결과에 따라 안내 문구를 바꾼다.
        // 응답을 기다리는 동안 더 고친 본문(pending)이 있으면 그쪽이 최신이므로 그것을 올린다. 충돌 뒤에는 pending을 버리기 때문이다.
        const latestMarkdown = pendingSaveRef.current
          ? substituteAttachmentPaths(pendingSaveRef.current.markdown, savedAttachmentPathsRef.current)
          : markdownToSave;
        const registered = await registerEditConflict(documentId, {
          markdown: latestMarkdown,
          base_revision: versionRef.current,
          client_conflict_id: clientConflictIdRef.current
        }).then(() => true, () => false);
        if (mountedRef.current) setErrorMessage(describeConflictRegistration(registered));
        else onDetachedSaveCompleteRef.current?.({ success: false, error: new Error(describeConflictRegistration(registered)) });
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
      if (autoSaveRef.current || !scheduledSaveRef.current) return;
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
    setErrorMessage(null);
    return trackedFlushSave(candidate);
  }

  return { status, errorMessage, contentVersion, queueSave, saveNow, reportSaveBlock };
}
