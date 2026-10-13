"use client";

import { useRouter } from "next/navigation";

/** 회원가입·비밀번호 재설정 화면 아래의 로그인 화면 안내. */
export function LoginLinkPrompt() {
  const router = useRouter();
  return (
    <p className="auth-prompt">이미 아이디가 있으신가요?<button onClick={() => router.push("/login")} type="button">로그인하기</button></p>
  );
}
