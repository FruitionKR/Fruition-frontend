"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";

type Confirmation = { title: string; description?: string; confirmLabel: string; tone?: "default" | "danger" };

/** 간단한 확인은 화면별 모달을 새로 만들지 않고 이 훅으로 요청한다. */
export function useConfirmation() {
  const titleId = useId();
  const [options, setOptions] = useState<Confirmation | null>(null);
  const pending = useRef<((accepted: boolean) => void) | null>(null);
  const settle = useCallback((accepted: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(accepted);
  }, []);
  useEffect(() => {
    const cancel = () => settle(false);
    window.addEventListener("fruition:auth-cleared", cancel);
    return () => {
      window.removeEventListener("fruition:auth-cleared", cancel);
      pending.current?.(false);
      pending.current = null;
    };
  }, [settle]);
  const confirm = useCallback((next: Confirmation): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false);
    setOptions(next);
    return new Promise((resolve) => { pending.current = resolve; });
  }, []);
  const confirmationDialog = options && <ConfirmModal titleId={titleId} title={options.title}
    description={options.description} confirmLabel={options.confirmLabel} tone={options.tone}
    onCancel={() => settle(false)} onConfirm={() => settle(true)} />;
  return { confirm, confirmationDialog };
}
