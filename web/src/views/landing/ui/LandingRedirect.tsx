"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/entities/user";

/** 랜딩 본문은 서버에서 그리고, 로그인 여부 확인만 클라이언트에서 한다. */
export function LandingRedirect() {
  const router = useRouter();
  // access token은 메모리에만 있어 새 탭에서는 비어 있지만, HttpOnly refresh 쿠키가 살아 있으면
  // /me 호출이 재발급을 거쳐 성공한다. 이미 로그인한 사용자는 로그인 화면을 거치지 않고 바로 들어간다.
  const { isSuccess } = useMe();

  useEffect(() => {
    if (isSuccess) router.replace("/workspaces");
  }, [isSuccess, router]);

  return null;
}
