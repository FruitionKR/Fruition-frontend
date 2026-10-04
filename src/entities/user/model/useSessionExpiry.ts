"use client";

import { useEffect } from "react";
import { setSessionExpiredHandler } from "@/shared/lib/auth";
import { useSignOut } from "./useSignOut";

/**
 * 세션 만료(refresh 실패)를 앱 전체에서 한 번만 처리한다.
 * 호출부마다 loginRequired를 보고 분기하면 대부분 놓쳐, 편집 화면에서는 저장되지 않는 입력이 계속 쌓인다.
 */
export function useSessionExpiry() {
  const { signOut } = useSignOut();

  useEffect(() => {
    setSessionExpiredHandler(() => {
      void signOut();
    });
    return () => setSessionExpiredHandler(null);
  }, [signOut]);
}
