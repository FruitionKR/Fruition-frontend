type Transport = { origin: string | null; directUpload: boolean };

const DOCUMENT_API = /^\/api\/workspaces\/[^/]+\/(?:documents|document-tree|folders|agent|chat|wiki-schema|skills)(?:\/|$)/;

/** AWS document API에만 Bearer를 전송한다. 인증·refresh는 기존 동일 출처 경로를 사용한다. */
export function usesDocumentTransport(path: string): boolean {
  return DOCUMENT_API.test(path);
}

// 배포 설정이라 페이지가 살아 있는 동안 바뀌지 않는다. 문서 API마다 다시 묻지 않도록 페이지(window)당 한 번만 조회한다.
const transports = new WeakMap<object, Promise<Transport>>();

export function getDocumentTransport(): Promise<Transport> {
  // 서버 렌더링과 기존 Node API 테스트는 상대 URL 경로를 유지한다.
  if (typeof window === "undefined" || process.env.NEXT_PUBLIC_DOCUMENT_DIRECT_API !== "true") return Promise.resolve({ origin: null, directUpload: false });
  const page = window;
  let transport = transports.get(page);
  if (!transport) {
    transport = fetchDocumentTransport();
    transports.set(page, transport);
    // 접근 코드 입력 전 403 같은 실패는 저장하지 않는다. 코드를 넣은 뒤 다음 호출이 다시 조회한다.
    transport.catch(() => transports.delete(page));
  }
  return transport;
}

async function fetchDocumentTransport(): Promise<Transport> {
  // 여러 요청이 결과를 나눠 쓰므로 한 호출자의 취소 신호를 넘기지 않는다.
  const response = await fetch("/api/document-transport", { cache: "no-store" });
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
