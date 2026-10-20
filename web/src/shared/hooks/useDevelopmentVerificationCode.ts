"use client";

import { useEffect, useRef } from "react";
import { isDevelopmentVerificationCode } from "@/shared/lib/developmentVerificationCode";

/** 개발 환경에서 고정 인증번호(9700)를 입력하면 제출을 기다리지 않고 한 번 onDetected를 부른다. */
export function useDevelopmentVerificationCode(
  code: string,
  onDetected: (code: string) => void | Promise<void>
) {
  const onDetectedRef = useRef(onDetected);
  const detectedRef = useRef(false);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!isDevelopmentVerificationCode(code)) {
      detectedRef.current = false;
      return;
    }

    if (detectedRef.current) return;

    detectedRef.current = true;
    void onDetectedRef.current(code);
  }, [code]);
}
