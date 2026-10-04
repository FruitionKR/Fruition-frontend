import { useEffect, useRef, useState } from "react";
import { ERROR_MESSAGES } from "@/shared/api/client";
import { getErrorMessage } from "@/shared/lib/errors";
import { acquireEditLock, EditLockHeldError, EditLockLostError, releaseEditLock, sendEditLockHeartbeat } from "../api/editLock";
import { resolveHeartbeatDelayMs } from "./editLockSchedule";

export type EditLockPhase =
  /** 진입 직후. 잠금을 받기 전까지는 편집기를 열지 않는다. */
  | "acquiring"
  /** 잠금 보유. 편집·저장 가능. */
  | "granted"
  /** 다른 사용자가 편집 중(423). */
  | "held"
  /** 편집 중 잠금을 잃음(heartbeat 409). 이미 입력한 내용은 보이되 저장은 멈춘다. */
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
 * heartbeat가 409(잠금 상실)를 받으면 onLockLost로 autosave를 멈춘다.
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

    function scheduleHeartbeat(expiresAt: string | undefined) {
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
      try {
        const lock = await sendEditLockHeartbeat(documentId);
        if (disposed) return;
        scheduleHeartbeat(lock.expires_at);
      } catch (error) {
        if (error instanceof EditLockLostError) {
          loseLock(error.message);
          return;
        }
        // 일시적인 네트워크 오류는 잠금 상실이 아니다. 만료 전에 다시 시도한다.
        if (!disposed) scheduleHeartbeat(undefined);
      }
    }

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
      if (timer) clearTimeout(timer);
      timer = null;
      // 보유 중일 때만 해제한다. 423·409 상태에서는 우리 잠금이 아니다.
      if (holding) void releaseEditLock(documentId).catch(() => {});
    };
  }, [documentId]);

  return state;
}
