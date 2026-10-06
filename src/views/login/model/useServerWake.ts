"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAccessGateStatus, submitAccessCode, type AccessCodeSubmitResult } from "@/shared/api/accessGate";
import { decideWakeStep, isReadyStatus, type WakePhase } from "@/views/login/model/wakeStep";

const POLL_INTERVAL_MS = 10_000;
// 이만큼 확인해도 준비가 끝나지 않으면 확인을 멈추고 나중에 다시 시도하라고 안내한다.
const MAX_POLL_DURATION_MS = 15 * 60_000;
const MAX_POLL_COUNT = MAX_POLL_DURATION_MS / POLL_INTERVAL_MS;

/** 로그인 화면의 접근 코드 확인 결과. error는 네트워크 오류처럼 코드 일치 여부를 모르는 경우다. */
export type AccessCodeResult = AccessCodeSubmitResult | "error";

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
 * 게이트가 꺼진 배포(enabled=false)는 /wake가 항상 막혀 있으므로 칸도 띄우지 않고 기동도 요청하지 않는다.
 * isPreparing: 안내 표시 여부. isWakeTimedOut: 15분 넘게 준비가 끝나지 않아 확인을 멈춘 상태.
 * isServerUnready: 비동기 처리 중에도 최신 값을 읽는 getter(준비 중이거나 확인을 멈춘 상태).
 * requestBeforeSubmit: 로그인 제출 직전에 기동을 한 번 더 요청한다(응답을 기다리지 않음).
 */
export function useServerWake() {
  const [isPreparing, setIsPreparing] = useState(false);
  const [isWakeTimedOut, setIsWakeTimedOut] = useState(false);
  const [isAccessCodeVisible, setIsAccessCodeVisible] = useState(false);
  const [isAccessCodeVerified, setIsAccessCodeVerified] = useState(false);
  const isUnlocked = useRef(false);
  // 로그인 제출의 catch처럼 렌더 시점 값이 오래될 수 있는 곳에서 읽는다.
  const isServerUnreadyRef = useRef(false);
  // 기동 요청·상태 확인 시작. 화면이 살아 있는 동안만 값이 있어, 언마운트 뒤 늦게 끝난 확인이 시작하지 못한다.
  const startRef = useRef<(() => void) | null>(null);
  // blur와 제출이 겹쳐도 같은 코드는 한 번만 확인하고, 실패한 코드는 다시 보내지 않는다.
  const pendingRef = useRef<{ code: string; result: Promise<AccessCodeResult> } | null>(null);
  const invalidCodeRef = useRef<string | null>(null);

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

    const schedule = () => {
      pollCount += 1;
      if (pollCount > MAX_POLL_COUNT) {
        // 준비 안내 대신 나중에 다시 시도하라는 안내를 남긴다. 서버는 여전히 준비 전으로 본다.
        setIsPreparing(false);
        setIsWakeTimedOut(true);
        return;
      }
      if (isHidden()) {
        paused = true;
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

    const start = () => {
      if (cancelled || isUnlocked.current) return;
      isUnlocked.current = true;
      requestServerWake();
      void check();
    };
    startRef.current = start;
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", resumeWhenVisible);

    void fetchAccessGateStatus()
      .then((status) => {
        if (cancelled) return;
        if (!status.enabled) return;
        if (status.unlocked) start();
        else setIsAccessCodeVisible(true);
      })
      // 상태를 모르면 칸을 띄우지 않고 지금처럼 로그인하게 둔다.
      .catch(() => undefined);

    return () => {
      cancelled = true;
      startRef.current = null;
      clearTimeout(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", resumeWhenVisible);
    };
  }, []);

  const unlockAccessCode = useCallback((rawCode: string): Promise<AccessCodeResult> => {
    // 서버(/access/verify)와 같이 앞뒤 공백을 무시한다.
    const code = rawCode.trim();
    if (isUnlocked.current) return Promise.resolve("ok");
    if (code === invalidCodeRef.current) return Promise.resolve("invalid");
    if (pendingRef.current?.code === code) return pendingRef.current.result;

    const result = submitAccessCode(code)
      .then((submitted): AccessCodeResult => {
        // 시도 제한(rate-limited)은 코드가 틀렸다는 뜻이 아니라 잠시 뒤 같은 코드로 다시 시도할 수 있게 기억하지 않는다.
        if (submitted === "invalid") invalidCodeRef.current = code;
        if (submitted !== "ok") return submitted;
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

  const isServerUnready = useCallback(() => isServerUnreadyRef.current, []);

  return {
    isPreparing,
    isWakeTimedOut,
    isAccessCodeVisible,
    isAccessCodeVerified,
    unlockAccessCode,
    requestBeforeSubmit,
    isServerUnready
  };
}
