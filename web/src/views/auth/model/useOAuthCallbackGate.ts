import { useCallback, useState } from "react";
import { parseOAuthSignupToken } from "@/entities/user/model/consent";
import { parseOAuthLinkCallback } from "@/entities/user/model/oauthLink";

/**
 * 로그인 화면이 OAuth 콜백을 처리하는 동안 남은 세션 확인(useMe)을 시작하지 않게 한다.
 *
 * 콜백 query는 처리하며 history.replaceState로 지우고, Next.js는 그 변경을 useSearchParams에 반영한다.
 * 지운 뒤의 query만 보면 /me → refresh가 code 교환과 겹쳐, 늦게 끝난 refresh가 직접 로그인 토큰(auth_time 있음)을
 * refresh 토큰(auth_time 없음)으로 덮어쓰고 소셜 계정 탈퇴의 본인 확인이 다시 실패한다(#253).
 * 그래서 연동 콜백과 code 교환 여부는 첫 렌더의 query로 정해 두고, 교환이 끝날 때까지 유지한다.
 */
export function useOAuthCallbackGate(searchParams: Pick<URLSearchParams, "get">) {
  const [isOAuthLinkCallback] = useState(() => parseOAuthLinkCallback(searchParams) !== null);
  // code 교환이 MFA 요구나 실패로 끝나면 finishOAuthLoginAttempt로 푼다. 성공하면 화면을 떠나므로 풀지 않는다.
  const [isOAuthLoginPending, setIsOAuthLoginPending] = useState(() => Boolean(searchParams.get("code")));
  const hasOAuthParams = Boolean(searchParams.get("code") || searchParams.get("error") || parseOAuthSignupToken(searchParams))
    || isOAuthLinkCallback;

  // 콜백 처리 effect의 deps에 들어가므로 렌더마다 바뀌지 않게 한다.
  const finishOAuthLoginAttempt = useCallback(() => setIsOAuthLoginPending(false), []);

  return {
    isOAuthLinkCallback,
    hasOAuthParams,
    canCheckSession: !hasOAuthParams && !isOAuthLoginPending,
    finishOAuthLoginAttempt
  };
}
