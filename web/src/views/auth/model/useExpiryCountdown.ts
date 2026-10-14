"use client";

import { useEffect, useState } from "react";

/** 인증번호 발송 후 재요청을 허용하기까지 기다리는 시간 */
const RESEND_DELAY_MS = 20_000;

function remainingSeconds(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

function formatRemainingTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type ExpiryCountdown = {
  label: string;
  isExpired: boolean;
  /** 발송 후 RESEND_DELAY_MS가 지났거나 만료되어 재요청할 수 있는지 */
  canResend: boolean;
};

export function useExpiryCountdown(expiresAt: number): ExpiryCountdown {
  const [seconds, setSeconds] = useState(() => remainingSeconds(expiresAt));
  // expiresAt을 받은 시각을 발송 시각으로 본다.
  const [startedAt, setStartedAt] = useState(() => Date.now());

  useEffect(() => {
    setStartedAt(Date.now());
    setSeconds(remainingSeconds(expiresAt));
    const timerId = window.setInterval(() => {
      setSeconds(remainingSeconds(expiresAt));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [expiresAt]);

  const isExpired = expiresAt > 0 && seconds <= 0;
  return {
    label: formatRemainingTime(seconds),
    isExpired,
    canResend: expiresAt > 0 && (isExpired || Date.now() - startedAt >= RESEND_DELAY_MS)
  };
}
