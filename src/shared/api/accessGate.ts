// 화면 서버의 접근 코드 게이트(/access/verify) 호출. 설정 화면과 로그인 화면이 함께 쓴다.
export type AccessGateStatus = { enabled: boolean; unlocked: boolean };

/** 접근 코드 확인 결과. rate-limited는 서버가 실패 횟수 초과로 잠시 막은 경우다(429). */
export type AccessCodeSubmitResult = "ok" | "invalid" | "rate-limited";

export async function fetchAccessGateStatus(): Promise<AccessGateStatus> {
  const response = await fetch("/access/verify", { cache: "no-store" });
  if (!response.ok) throw new Error("접근 코드 상태를 확인하지 못했습니다.");
  return response.json() as Promise<AccessGateStatus>;
}

/** 코드가 맞으면 접근 쿠키를 받고 ok, 틀리면 invalid, 시도 제한에 걸리면 rate-limited. 네트워크 오류는 throw한다. */
export async function submitAccessCode(code: string): Promise<AccessCodeSubmitResult> {
  const response = await fetch("/access/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  if (response.ok) return "ok";
  return response.status === 429 ? "rate-limited" : "invalid";
}
