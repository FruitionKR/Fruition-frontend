"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAccessGateStatus, submitAccessCode } from "@/shared/api/accessGate";
import { decideWakeStep, isReadyStatus, type WakePhase } from "@/views/login/model/wakeStep";

const POLL_INTERVAL_MS = 10_000;

/** 로그인 화면의 접근 코드 확인 결과. error는 네트워크 오류처럼 코드 일치 여부를 모르는 경우다. */
export type AccessCodeResult = "ok" | "invalid" | "error";

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

/**
 * 로그인 화면 진입 시 접근 코드가 통과된 브라우저면 서버 기동을 요청하고, 절전·기동 중이면 준비 안내를 띄운다.
 * 접근 쿠키가 없는 브라우저는 isAccessCodeVisible로 접근 코드 칸을 띄우고, unlockAccessCode가 통과하면 같은 흐름을 시작한다.
 * isPreparing: 안내 표시 여부. requestBeforeSubmit: 로그인 제출 직전에 기동을 한 번 더 요청한다(응답을 기다리지 않음).
 */
export function useServerWake() {
  const [isPreparing, setIsPreparing] = useState(false);
  const [isAccessCodeVisible, setIsAccessCodeVisible] = useState(false);
  const [isAccessCodeVerified, setIsAccessCodeVerified] = useState(false);
  const isUnlocked = useRef(false);
  // 기동 요청·상태 확인 시작. 화면이 살아 있는 동안만 값이 있어, 언마운트 뒤 늦게 끝난 확인이 시작하지 못한다.
  const startRef = useRef<(() => void) | null>(null);
  // blur와 제출이 겹쳐도 같은 코드는 한 번만 확인하고, 실패한 코드는 다시 보내지 않는다.
  const pendingRef = useRef<{ code: string; result: Promise<AccessCodeResult> } | null>(null);
  const invalidCodeRef = useRef<string | null>(null);

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

    const start = () => {
      if (cancelled || isUnlocked.current) return;
      isUnlocked.current = true;
      requestServerWake();
      void check();
    };
    startRef.current = start;

    void fetchAccessGateStatus()
      .then((status) => {
        if (cancelled) return;
        if (!status.enabled || status.unlocked) start();
        else setIsAccessCodeVisible(true);
      })
      // 상태를 모르면 칸을 띄우지 않고 지금처럼 로그인하게 둔다.
      .catch(() => undefined);

    return () => {
      cancelled = true;
      startRef.current = null;
      clearTimeout(timer);
    };
  }, []);

  const unlockAccessCode = useCallback((rawCode: string): Promise<AccessCodeResult> => {
    // 서버(/access/verify)와 같이 앞뒤 공백을 무시한다.
    const code = rawCode.trim();
    if (isUnlocked.current) return Promise.resolve("ok");
    if (code === invalidCodeRef.current) return Promise.resolve("invalid");
    if (pendingRef.current?.code === code) return pendingRef.current.result;

    const result = submitAccessCode(code)
      .then((ok): AccessCodeResult => {
        if (!ok) {
          invalidCodeRef.current = code;
          return "invalid";
        }
        setIsAccessCodeVerified(true);
        startRef.current?.();
        return "ok";
      })
      .catch((): AccessCodeResult => "error")
      .finally(() => {
        if (pendingRef.current?.result === result) pendingRef.current = null;
      });
    pendingRef.current = { code, result };
    return result;
  }, []);

  const requestBeforeSubmit = useCallback(() => {
    if (isUnlocked.current) requestServerWake();
  }, []);

  return { isPreparing, isAccessCodeVisible, isAccessCodeVerified, unlockAccessCode, requestBeforeSubmit };
}
