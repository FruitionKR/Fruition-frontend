/**
 * 세션 종료 사유.
 * - "user": 사용자가 로그아웃을 직접 골랐다. 앱을 떠나려는 뜻이므로 랜딩(/)으로 보낸다.
 * - "reauth": 만료·인증 실패·계정 전환처럼 다시 로그인해야 하는 경우. 로그인 화면으로 보낸다.
 */
export type SignOutReason = "user" | "reauth";

export function signOutDestination(reason: SignOutReason = "reauth"): string {
  return reason === "user" ? "/" : "/login";
}
