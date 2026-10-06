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

/**
 * 쿠키 값이 기대 해시와 같은지 상수 시간으로 비교한다. 쿠키 값이 곧 해시라 비교 시간으로 해시를 알아내면 쿠키를 위조할 수 있다.
 * middleware(Edge)에서도 쓰므로 Node의 timingSafeEqual 대신 순수 JS로, 길이가 달라도 기대 값 끝까지 비교한다.
 */
export function isSameAccessToken(token: string | undefined, expected: string): boolean {
  if (!token) return false;
  let diff = token.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= (token.charCodeAt(index) || 0) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

/** 접근 코드가 설정되어 있고 쿠키 값이 그 코드를 통과했는지. ACCESS_CODE 미설정이면 false다(/wake처럼 게이트가 꺼져도 열면 안 되는 곳에 쓴다). */
export async function hasVerifiedAccessCode(token: string | undefined): Promise<boolean> {
  const accessCode = getAccessCode();
  if (!accessCode) return false;
  return isSameAccessToken(token, await hashAccessCode(accessCode));
}
