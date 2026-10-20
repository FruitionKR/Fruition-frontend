import { useEffect, useRef, useState } from "react";
import { ERROR_MESSAGES } from "@/shared/api/client";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { SessionExpiredError } from "@/shared/lib/apiErrors";
import { acquireEditLock, EditLockDeniedError, EditLockHeldError, EditLockLostError, EditLockUnsupportedError, releaseEditLock, sendEditLockHeartbeat, type EditLockResponse } from "../api/editLock";
import { createEditLockHandoffs, type HeldEditLock } from "./editLockHandoff";
import { HEARTBEAT_RETRY_MS, resolveHeartbeatDelayMs, resolveHeartbeatFailure, resolveLockElapsedMs, resolveLockRemainingMs, type LockClockAnchor } from "./editLockSchedule";

type EditLockPhase =
  /** 진입 직후. 잠금을 받기 전까지는 편집기를 열지 않는다. */
  | "acquiring"
  /** 잠금 보유. 편집·저장 가능. */
  | "granted"
  /** 다른 사용자가 편집 중(423). */
  | "held"
  /** 편집 중 잠금을 잃음(heartbeat 409 후 재획득 실패). 이미 입력한 내용은 보이되 저장은 멈춘다. */
  | "lost"
  /** 403·404·네트워크 등으로 잠금을 확인하지 못함. */
  | "error";

type EditLockState = {
  phase: EditLockPhase;
  /** phase가 granted가 아니면 사용자에게 보여줄 안내 문구. */
  message: string | null;
};

/**
 * 편집 잠금을 쓸 수 없다고 서버가 답한 문서(400)와 그 안내 문구.
 * 편집기가 다시 마운트돼도(본문 재로드·목록 갱신) 같은 400을 반복 요청하지 않는다.
 */
const unsupportedLockDocuments = new Map<string, string>();

/**
 * 사라진 편집기의 잠금을 잠깐 맡아 두는 곳. 같은 문서의 편집기가 곧바로 다시 마운트되면(StrictMode 이중 마운트·재로드)
 * 해제·재획득 없이 넘겨받고, 아니면 잠시 뒤 해제한다. 페이지를 떠날 때(pagehide)는 기다리지 않고 해제한다.
 */
const editLockHandoffs = createEditLockHandoffs({ release: releaseEditLock });
if (typeof window !== "undefined") window.addEventListener("pagehide", () => editLockHandoffs.flush());

/** 맡겨 둔 잠금을 해제하지 않고 잊는다. 테스트끼리 넘겨받기가 섞이지 않게 할 때만 쓴다. */
export function discardEditLockHandoffs() {
  editLockHandoffs.discard();
}

/**
 * 문서 편집 잠금을 진입 시 획득하고, 편집 중 주기적으로 연장하고, 종료 시 해제한다.
 * heartbeat가 409를 받으면 재획득을 시도하고, 그래도 받지 못하면 onLockLost로 autosave를 멈춘다.
 */
export function useEditLock({
  documentId,
  onLockLost
}: {
  documentId: string;
  /** 잠금을 잃어 더 이상 저장해서는 안 될 때. useNoteAutosave의 reportSaveBlock에 연결한다. */
  onLockLost: (message: string) => void;
}): EditLockState {
  const [state, setState] = useState<EditLockState>(() => {
    const unsupported = unsupportedLockDocuments.get(documentId);
    return unsupported ? { phase: "error", message: unsupported } : { phase: "acquiring", message: null };
  });
  const onLockLostRef = useRef(onLockLost);
  onLockLostRef.current = onLockLost;

  useEffect(() => {
    const unsupported = unsupportedLockDocuments.get(documentId);
    if (unsupported) {
      setState({ phase: "error", message: unsupported });
      return;
    }
    let disposed = false;
    let holding = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 마지막 응답 기준 남은 잠금 시간과, 그 시간을 셀 기준점(요청을 보낸 시점).
    // heartbeat를 언제까지 다시 시도할지의 기준이다. 서버 TTL을 로컬 경과 시간과 비교해
    // 클라이언트 벽시계가 서버와 어긋나도 흔들리지 않는다.
    let remainingMs: number | null = null;
    let anchor: LockClockAnchor = { monoMs: 0, wallMs: 0 };
    // 마지막으로 받은(연장한) 잠금. 편집기가 사라질 때 다음 편집기에 넘겨주려고 둔다.
    let lastHeld: HeldEditLock | null = null;
    // 처음 획득이 진행 중이면 그 요청. 끝나기 전에 사라지면 그대로 맡긴다.
    let acquiring: Promise<HeldEditLock> | null = null;
    // heartbeat(재획득 포함)가 진행 중인지. 탭 복귀 즉시 heartbeat가 예약 heartbeat와 겹치지 않게 한다.
    let beating = false;

    /** 요청 직전에 기준점을 잡는다. 응답 지연만큼 마감이 늦게 잡히지 않게 한다. */
    function markSent(): LockClockAnchor {
      return { monoMs: performance.now(), wallMs: Date.now() };
    }

    /** elapsedMs는 넘겨받은 잠금처럼 받은 지 이미 시간이 흐른 경우, 그만큼 heartbeat를 당긴다. */
    function scheduleHeartbeat(lock: EditLockResponse, sentAt: LockClockAnchor, elapsedMs = 0) {
      remainingMs = resolveLockRemainingMs(lock, sentAt.wallMs);
      anchor = sentAt;
      lastHeld = { lock, sentAt };
      timer = setTimeout(beat, Math.max(0, resolveHeartbeatDelayMs(lock.expires_at, sentAt.wallMs, lock.ttl_ms) - elapsedMs));
    }

    function loseLock(message: string) {
      holding = false;
      lastHeld = null;
      timer = null;
      if (disposed) return;
      setState({ phase: "lost", message });
      onLockLostRef.current(message);
    }

    async function beat() {
      timer = null;
      beating = true;
      try {
        await sendHeartbeat();
      } finally {
        beating = false;
      }
    }

    async function sendHeartbeat() {
      try {
        const sentAt = markSent();
        const lock = await sendEditLockHeartbeat(documentId);
        if (disposed) return;
        scheduleHeartbeat(lock, sentAt);
      } catch (error) {
        // 409는 만료 또는 타인 보유다. 백그라운드 탭 타이머 지연·절전으로 heartbeat가 늦으면
        // 혼자 쓰는 문서도 만료되므로, 바로 잃지 않고 재획득으로 어느 쪽인지 확인한다.
        if (error instanceof EditLockLostError) {
          if (!disposed) await reacquire(error);
          return;
        }
        const action = resolveHeartbeatFailure(error, remainingMs, resolveLockElapsedMs(anchor, performance.now(), Date.now()));
        if (action === "terminal") {
          loseLock(getErrorMessage(error, ERROR_MESSAGES.editLockExpired));
          return;
        }
        if (disposed) return;
        // 만료 전이면 서버 잠금은 아직 우리 것이다. 연결이 돌아올 때까지 두드린다.
        if (action === "retry") {
          timer = setTimeout(beat, HEARTBEAT_RETRY_MS);
          return;
        }
        // 만료됐으면 보유를 주장하지 않고, 아무도 가져가지 않았는지 재획득으로 확인한다.
        await reacquire(error);
      }
    }

    /**
     * 만료된 잠금을 다시 받아 편집을 이어간다.
     * 연결이 돌아왔고 아무도 가져가지 않았다면 편집기는 그대로 살아난다.
     * 그래도 받지 못하면 서버가 이미 만료시킨 잠금이므로 보유 중이라고 주장하지 않는다.
     */
    async function reacquire(lastError: unknown) {
      try {
        const sentAt = markSent();
        const lock = await acquireEditLock(documentId);
        if (disposed) {
          void releaseEditLock(documentId).catch(() => {});
          return;
        }
        holding = true;
        setState({ phase: "granted", message: null });
        scheduleHeartbeat(lock, sentAt);
      } catch (error) {
        // 보유자 이름이 없는 423도 다른 사용자가 가져간 것이 확인된 경우라 그 사실을 알린다.
        if (error instanceof EditLockHeldError && !error.lock.holder_display_name?.trim()) {
          loseLock(ERROR_MESSAGES.editLockLost);
          return;
        }
        const reason = error instanceof EditLockHeldError
          || error instanceof EditLockDeniedError
          || error instanceof SessionExpiredError
          ? error
          : lastError;
        loseLock(getErrorMessage(reason, ERROR_MESSAGES.editLockExpired));
      }
    }

    /**
     * 탭이 다시 보이거나 연결이 돌아오면 예약을 기다리지 않고 바로 연장한다.
     * 숨겨진 탭의 타이머는 브라우저가 분 단위로 늦추므로, 복귀 시점에 만료 전에 잠금을 붙잡는다.
     */
    function beatNow() {
      if (!holding || beating || disposed) return;
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      void beat();
    }

    document.addEventListener("visibilitychange", beatNow);
    window.addEventListener("online", beatNow);

    // 방금 사라진 같은 문서의 편집기가 맡긴 잠금이 있으면 넘겨받는다. 없으면 새로 획득한다.
    const claimed = editLockHandoffs.claim(documentId);
    const initialSentAt = markSent();
    const initial: Promise<HeldEditLock> = claimed
      ?? acquireEditLock(documentId).then((lock) => ({ lock, sentAt: initialSentAt }));
    acquiring = initial;
    initial.then(
      ({ lock, sentAt }) => {
        acquiring = null;
        // 떠난 편집기의 잠금은 editLockHandoffs가 맡아 넘겨주거나 해제한다.
        if (disposed) return;
        holding = true;
        setState({ phase: "granted", message: null });
        scheduleHeartbeat(lock, sentAt, claimed ? resolveLockElapsedMs(sentAt, performance.now(), Date.now()) : 0);
      },
      (error) => {
        acquiring = null;
        if (error instanceof EditLockUnsupportedError) unsupportedLockDocuments.set(documentId, error.message);
        if (disposed) return;
        setState(
          error instanceof EditLockHeldError
            ? { phase: "held", message: error.message }
            : { phase: "error", message: getErrorMessage(error, ERROR_MESSAGES.editLockFailed) }
        );
      }
    );

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", beatNow);
      window.removeEventListener("online", beatNow);
      if (timer) clearTimeout(timer);
      timer = null;
      // 보유 중이거나 획득 중인 잠금만 맡긴다(곧 다시 마운트되면 넘겨주고, 아니면 잠시 뒤 해제한다).
      // 423·409 상태에서는 우리 잠금이 아니다.
      if (acquiring) editLockHandoffs.defer(documentId, acquiring);
      else if (holding && lastHeld) editLockHandoffs.defer(documentId, Promise.resolve(lastHeld));
    };
  }, [documentId]);

  return state;
}
