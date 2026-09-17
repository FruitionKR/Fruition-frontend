// 접근 코드 게이트. 코드는 서버 전용 환경변수 ACCESS_CODE로 설정한다.
export const ACCESS_COOKIE = "fruition_access";
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function getAccessCode(): string | null {
  const code = process.env.ACCESS_CODE?.trim();
  return code ? code : null;
}

// 쿠키에는 코드 원문 대신 sha256 해시를 담는다. Edge(middleware)와 Node 양쪽에서 동작하도록 Web Crypto 사용.
export async function hashAccessCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
