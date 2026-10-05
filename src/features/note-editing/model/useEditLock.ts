import { useEffect, useRef, useState } from "react";
import { ERROR_MESSAGES } from "@/shared/api/client";
import { getErrorMessage } from "@/shared/lib/errors";
import { SessionExpiredError } from "@/shared/lib/errors";
import { acquireEditLock, EditLockDeniedError, EditLockHeldError, EditLockLostError, releaseEditLock, sendEditLockHeartbeat } from "../api/editLock";
import { HEARTBEAT_RETRY_MS, parseLockExpiryMs, resolveHeartbeatDelayMs, resolveHeartbeatFailure } from "./editLockSchedule";

export type EditLockPhase =
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

export type EditLockState = {
  phase: EditLockPhase;
  /** phase가 granted가 아니면 사용자에게 보여줄 안내 문구. */
  message: string | null;
};

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
  const [state, setState] = useState<EditLockState>({ phase: "acquiring", message: null });
  const onLockLostRef = useRef(onLockLost);
  onLockLostRef.current = onLockLost;

  useEffect(() => {
    let disposed = false;
    let holding = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 서버가 마지막으로 알려준 잠금 만료 시각. heartbeat를 언제까지 다시 시도할지의 기준이다.
    let expiresAtMs: number | null = null;
    // heartbeat(재획득 포함)가 진행 중인지. 탭 복귀 즉시 heartbeat가 예약 heartbeat와 겹치지 않게 한다.
    let beating = false;

    function scheduleHeartbeat(expiresAt: string | undefined) {
      expiresAtMs = parseLockExpiryMs(expiresAt);
      timer = setTimeout(beat, resolveHeartbeatDelayMs(expiresAt, Date.now()));
    }

    function loseLock(message: string) {
      holding = false;
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
        const lock = await sendEditLockHeartbeat(documentId);
        if (disposed) return;
        scheduleHeartbeat(lock.expires_at);
      } catch (error) {
        // 409는 만료 또는 타인 보유다. 백그라운드 탭 타이머 지연·절전으로 heartbeat가 늦으면
        // 혼자 쓰는 문서도 만료되므로, 바로 잃지 않고 재획득으로 어느 쪽인지 확인한다.
        if (error instanceof EditLockLostError) {
          if (!disposed) await reacquire(error);
          return;
        }
        const action = resolveHeartbeatFailure(error, expiresAtMs, Date.now());
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
        const lock = await acquireEditLock(documentId);
        if (disposed) {
          void releaseEditLock(documentId).catch(() => {});
          return;
        }
        holding = true;
        setState({ phase: "granted", message: null });
        scheduleHeartbeat(lock.expires_at);
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

    acquireEditLock(documentId).then(
      (lock) => {
        if (disposed) {
          // 획득 응답이 늦게 와도 떠난 문서의 잠금을 쥐고 있지 않는다.
          void releaseEditLock(documentId).catch(() => {});
          return;
        }
        holding = true;
        setState({ phase: "granted", message: null });
        scheduleHeartbeat(lock.expires_at);
      },
      (error) => {
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
      // 보유 중일 때만 해제한다. 423·409 상태에서는 우리 잠금이 아니다.
      if (holding) void releaseEditLock(documentId).catch(() => {});
    };
  }, [documentId]);

  return state;
}
