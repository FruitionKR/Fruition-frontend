import type { EditLockResponse } from "../api/editLock";
import type { LockClockAnchor } from "./editLockSchedule";

/** 받았거나 받는 중인 잠금과, 그 요청을 보낸 시점(heartbeat 예약 기준점). */
export type HeldEditLock = { lock: EditLockResponse; sentAt: LockClockAnchor };

/**
 * 편집기가 사라진 뒤 잠금을 실제로 해제하기까지 기다리는 시간.
 * React StrictMode의 개발 모드 이중 마운트나 본문 재로드처럼 같은 문서의 편집기가 곧바로 다시 마운트되면
 * 그 사이에 잠금을 넘겨받아 POST·DELETE가 엇갈리지 않게 한다(해제가 새 잠금을 지워 heartbeat가 409가 되던 문제).
 */
export const EDIT_LOCK_RELEASE_DELAY_MS = 1_000;

type Timer = ReturnType<typeof setTimeout>;

type PendingRelease = { held: Promise<HeldEditLock>; timer: Timer };

/**
 * 사라진 편집기의 잠금을 잠시 맡아 두었다가, 같은 문서의 편집기가 다시 마운트되면 넘겨주고(claim)
 * 아무도 가져가지 않으면 해제한다. 문서 하나에 맡긴 잠금은 하나뿐이다.
 * 맡긴 잠금이 아직 획득 중이어도 그대로 맡긴다(획득이 끝난 뒤 넘겨주거나 해제한다).
 */
export function createEditLockHandoffs({
  release,
  delayMs = EDIT_LOCK_RELEASE_DELAY_MS,
  // 호출할 때마다 전역 타이머를 찾는다(테스트의 mock timer도 따르게).
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer)
}: {
  /** 서버 잠금 해제. keepalive는 페이지를 떠나는 중이라 요청이 끊기지 않게 할 때 true다. */
  release: (documentId: string, options: { keepalive: boolean }) => Promise<void>;
  delayMs?: number;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}) {
  const pending = new Map<string, PendingRelease>();

  function releaseWhenHeld(documentId: string, held: Promise<HeldEditLock>, keepalive: boolean) {
    // 획득에 실패했으면 우리 잠금이 아니므로 해제하지 않는다.
    held.then(() => release(documentId, { keepalive })).catch(() => {});
  }

  return {
    /** 편집기가 사라질 때 보유 중이거나 획득 중인 잠금을 맡긴다. delayMs 안에 claim되지 않으면 해제한다. */
    defer(documentId: string, held: Promise<HeldEditLock>) {
      const previous = pending.get(documentId);
      if (previous) clearTimer(previous.timer);
      // 같은 문서에 이미 맡긴 잠금이 있으면(같은 문서를 연 두 편집기) 서버 잠금은 하나라 한 번만 넘기거나 해제한다.
      // 나중 것이 획득에 실패했으면 먼저 받은 잠금을 쓴다.
      if (previous) held = held.catch(() => previous.held);
      const timer = setTimer(() => {
        if (pending.get(documentId)?.timer !== timer) return;
        pending.delete(documentId);
        releaseWhenHeld(documentId, held, false);
      }, delayMs);
      pending.set(documentId, { held, timer });
    },
    /** 다시 마운트된 편집기가 맡겨 둔 잠금을 넘겨받는다. 없으면 null(새로 획득한다). */
    claim(documentId: string): Promise<HeldEditLock> | null {
      const entry = pending.get(documentId);
      if (!entry) return null;
      clearTimer(entry.timer);
      pending.delete(documentId);
      return entry.held;
    },
    /** 페이지를 떠날 때 기다리지 않고 맡긴 잠금을 모두 해제한다(타이머는 페이지와 함께 사라진다). */
    flush() {
      for (const [documentId, entry] of pending) {
        clearTimer(entry.timer);
        releaseWhenHeld(documentId, entry.held, true);
      }
      pending.clear();
    },
    /** 맡긴 잠금을 해제하지 않고 잊는다(테스트 격리용). */
    discard() {
      for (const entry of pending.values()) clearTimer(entry.timer);
      pending.clear();
    }
  };
}

export type EditLockHandoffs = ReturnType<typeof createEditLockHandoffs>;
