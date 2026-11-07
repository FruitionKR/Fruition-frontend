"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { isPublicAuthPath, setSessionExpiredHandler } from "@/shared/lib/authSessionStorage";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";
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
  const pathname = usePathname();
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    setSessionExpiredHandler(() => setIsExpired(true));
    return () => setSessionExpiredHandler(null);
  }, []);

  const t = useTranslations("shared");
  const stay = useCallback(() => setIsExpired(false), []);
  const relogin = useCallback(() => {
    setIsExpired(false);
    void signOut();
  }, [signOut]);

  return (
    <>
      {children}
      {/* 로그인·회원가입 화면에는 지킬 편집 내용이 없고, 안내가 로그인 폼을 가리면 다시 로그인할 수 없다. */}
      {isExpired && !isPublicAuthPath(pathname) && (
        <ConfirmModal
          titleId="session-expired-title"
          title={t("user.sessionExpiry.title")}
          description={t("user.sessionExpiry.description")}
          confirmLabel={t("user.sessionExpiry.relogin")}
          cancelLabel={t("user.sessionExpiry.stay")}
          onConfirm={relogin}
          onCancel={stay}
        />
      )}
    </>
  );
}
