"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decideWakeStep, isReadyStatus, type WakePhase } from "@/views/auth/model/wakeStep";

const POLL_INTERVAL_MS = 10_000;
// 이만큼 확인해도 준비가 끝나지 않으면 확인을 멈추고 나중에 다시 시도하라고 안내한다.
const MAX_POLL_DURATION_MS = 15 * 60_000;
const MAX_POLL_COUNT = MAX_POLL_DURATION_MS / POLL_INTERVAL_MS;

// 아래 요청은 모두 화면 흐름을 막지 않도록 실패를 흡수한다. 서버 쪽(/wake)이 실패 로그를 남긴다.
function requestServerWake(): void {
  fetch("/wake", { method: "POST", cache: "no-store" }).catch(() => undefined);
}

async function fetchWakePhase(): Promise<WakePhase> {
  try {
    const response = await fetch("/wake", { cache: "no-store" });
    if (!response.ok) return "unknown";
    const body = (await response.json()) as { phase?: WakePhase };
    return body.phase ?? "unknown";
  } catch {
    return "unknown";
  }
}

// apiFetch를 쓰지 않는다. 토큰 없이 보내 401이 와도 재발급을 시도하지 않고, 응답이 왔다는 것만 본다.
async function isAppReady(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    return isReadyStatus(response.status);
  } catch {
    return false;
  }
}

/** 로그인 화면 진입과 제출 시 서버 기동을 요청하고 준비 상태를 안내한다. */
export function useServerWake() {
  const [isPreparing, setIsPreparing] = useState(false);
  const [isWakeTimedOut, setIsWakeTimedOut] = useState(false);
  // 로그인 제출의 catch처럼 렌더 시점 값이 오래될 수 있는 곳에서 읽는다.
  const isServerUnreadyRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isNoticeShown = false;
    let pollCount = 0;
    // 숨김 탭에서 다음 확인을 예약하지 않은 상태. 다시 보이면 바로 한 번 확인한다.
    let paused = false;
    const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

    const showPreparing = (value: boolean) => {
      isServerUnreadyRef.current = value;
      setIsPreparing(value);
    };

    // 숨김 탭에서 처음 열려도 진입 시 확인은 한 번 하고, 다음 확인부터 멈춘다.
    // 멈출 때는 확인 횟수를 세지 않아, 숨겨 둔 시간이 15분 상한에 들어가지 않는다.
    const schedule = () => {
      if (isHidden()) {
        paused = true;
        return;
      }
      pollCount += 1;
      if (pollCount > MAX_POLL_COUNT) {
        // 준비 안내 대신 나중에 다시 시도하라는 안내를 남긴다. 서버는 여전히 준비 전으로 본다.
        setIsPreparing(false);
        setIsWakeTimedOut(true);
        return;
      }
      timer = setTimeout(() => void check(), POLL_INTERVAL_MS);
    };

    const resumeWhenVisible = () => {
      if (!paused || cancelled || isHidden()) return;
      paused = false;
      void check();
    };

    const check = async () => {
      const phase = await fetchWakePhase();
      if (cancelled) return;
      const step = decideWakeStep(phase, isNoticeShown);
      if (step === "stop") return;

      if (step === "probe") {
        const ready = await isAppReady();
        if (cancelled) return;
        if (ready) {
          isNoticeShown = false;
          showPreparing(false);
          return;
        }
      } else {
        isNoticeShown = true;
        showPreparing(true);
        if (step === "request-wake") requestServerWake();
      }
      schedule();
    };

    if (typeof document !== "undefined") document.addEventListener("visibilitychange", resumeWhenVisible);
    requestServerWake();
    void check();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", resumeWhenVisible);
    };
  }, []);

  const requestBeforeSubmit = useCallback(() => requestServerWake(), []);

  const isServerUnready = useCallback(() => isServerUnreadyRef.current, []);

  return {
    isPreparing,
    isWakeTimedOut,
    requestBeforeSubmit,
    isServerUnready
  };
}
