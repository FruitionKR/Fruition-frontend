"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { clearSessionCache } from "@/entities/chat";
import { logout } from "@/entities/user/api/auth";
import { clearAuth, markSignedOutByUser } from "@/shared/lib/authSessionStorage";
import { signOutDestination, type SignOutReason } from "./signOutDestination";

/**
 * 세션 종료 공통 절차: (선택) 서버 로그아웃 → 채팅 캐시 정리 → 인증 상태 정리 → 사유별 화면 이동.
 * 사용자가 직접 로그아웃하면(reason "user") 랜딩으로, 그 밖에는 로그인 화면으로 간다.
 * 앱 화면으로 돌아가지 않도록 history를 남기지 않는 replace를 사용한다.
 */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const signOut = useCallback(
    async (options?: { callLogout?: boolean; reason?: SignOutReason }) => {
      if (options?.callLogout) await logout().catch(() => undefined);
      clearSessionCache();
      // 사용자 범위 react-query 캐시(me·workspaces 등)를 비워 다음 로그인에 이전 사용자 데이터가 남지 않게 한다.
      queryClient.clear();
      clearAuth();
      // 서버 로그아웃이 실패해 refresh 쿠키가 남아도 로그인 화면이 곧장 앱으로 되돌려 보내지 않게 표시한다.
      if (options?.reason === "user") markSignedOutByUser();
      router.replace(signOutDestination(options?.reason));
    },
    [queryClient, router]
  );

  return { signOut };
}
