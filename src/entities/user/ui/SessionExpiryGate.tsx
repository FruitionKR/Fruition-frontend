"use client";

import { useCallback, useEffect, useState } from "react";
import { setSessionExpiredHandler } from "@/shared/lib/auth";
import { ConfirmModal } from "@/shared/ui/ConfirmModal";
import { useSignOut } from "../model/useSignOut";

/**
 * 세션 만료(refresh 실패)를 앱 전체에서 한 번만 처리한다.
 *
 * 만료 즉시 로그아웃하면 /login으로 이동하면서 편집기가 언마운트돼,
 * 아직 서버에 쓰지 못한 입력이 그대로 사라진다. 그래서 children은 유지한 채
 * 안내만 띄우고, 실제 로그아웃은 사용자가 "다시 로그인"을 고를 때 수행한다.
 */
export function SessionExpiryGate({ children }: { children: React.ReactNode }) {
  const { signOut } = useSignOut();
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    setSessionExpiredHandler(() => setIsExpired(true));
    return () => setSessionExpiredHandler(null);
  }, []);

  const stay = useCallback(() => setIsExpired(false), []);
  const relogin = useCallback(() => {
    setIsExpired(false);
    void signOut();
  }, [signOut]);

  return (
    <>
      {children}
      {isExpired && (
        <ConfirmModal
          titleId="session-expired-title"
          title="세션이 만료되었습니다."
          description="저장되지 않은 편집 내용은 다시 로그인할 때까지 이 화면에 그대로 남아 있습니다. 필요하면 본문을 복사한 뒤 로그인해 주세요."
          confirmLabel="다시 로그인"
          cancelLabel="이 화면에 머무르기"
          onConfirm={relogin}
          onCancel={stay}
        />
      )}
    </>
  );
}
