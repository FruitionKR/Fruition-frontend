"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decideWakeStep, isReadyStatus, type WakePhase } from "@/views/login/model/wakeStep";

const POLL_INTERVAL_MS = 10_000;

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

async function fetchAccessUnlocked(): Promise<boolean> {
  try {
    const response = await fetch("/access/verify", { cache: "no-store" });
    if (!response.ok) return false;
    const body = (await response.json()) as { unlocked?: boolean };
    return body.unlocked === true;
  } catch {
    return false;
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

/**
 * 로그인 화면 진입 시 접근 코드가 통과된 브라우저면 서버 기동을 요청하고, 절전·기동 중이면 준비 안내를 띄운다.
 * isPreparing: 안내 표시 여부. requestBeforeSubmit: 로그인 제출 직전에 기동을 한 번 더 요청한다(응답을 기다리지 않음).
 */
export function useServerWake() {
  const [isPreparing, setIsPreparing] = useState(false);
  const isUnlocked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isNoticeShown = false;

    const schedule = () => {
      timer = setTimeout(() => void check(), POLL_INTERVAL_MS);
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
          setIsPreparing(false);
          return;
        }
      } else {
        isNoticeShown = true;
        setIsPreparing(true);
        if (step === "request-wake") requestServerWake();
      }
      schedule();
    };

    void fetchAccessUnlocked().then((unlocked) => {
      if (cancelled || !unlocked) return;
      isUnlocked.current = true;
      requestServerWake();
      void check();
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const requestBeforeSubmit = useCallback(() => {
    if (isUnlocked.current) requestServerWake();
  }, []);

  return { isPreparing, requestBeforeSubmit };
}
