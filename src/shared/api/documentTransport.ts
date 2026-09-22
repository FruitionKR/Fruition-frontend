type Transport = { origin: string | null; directUpload: boolean };

const DOCUMENT_API = /^\/api\/workspaces\/[^/]+\/(?:documents|document-tree|folders|agent|chat|wiki-schema|skills)(?:\/|$)/;

/** AWS document API에만 Bearer를 전송한다. 인증·refresh는 기존 동일 출처 경로를 사용한다. */
export function usesDocumentTransport(path: string): boolean {
  return DOCUMENT_API.test(path);
}

export async function getDocumentTransport(signal?: AbortSignal | null): Promise<Transport> {
  // 서버 렌더링과 기존 Node API 테스트는 상대 URL 경로를 유지한다.
  if (typeof window === "undefined" || process.env.NEXT_PUBLIC_DOCUMENT_DIRECT_API !== "true") return { origin: null, directUpload: false };
  const response = await fetch("/api/document-transport", { cache: "no-store", signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? "문서 전송 연결을 확인하지 못했습니다.");
  }
  const transport = await response.json() as Transport;
  if (transport.origin) {
    const url = new URL(transport.origin);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local))
        || url.username || url.password || url.origin !== transport.origin) {
      throw new Error("문서 서버 주소가 올바르지 않습니다.");
    }
  }
  return transport;
}
