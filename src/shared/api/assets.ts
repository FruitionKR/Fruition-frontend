import { apiFetch, throwIfNotOk } from "@/shared/api/client";

// 백엔드가 본문 저장 응답에서 치환해 주는 관리 이미지 경로 (REQ-005)
const MANAGED_ASSET_PATH = /^\/api\/workspaces\/[^/]+\/assets\/[^/]+\/content$/;

/** 워크스페이스 멤버만 볼 수 있는 관리 이미지 경로인지. 일반 <img src>로 요청하면 401이라 JWT fetch가 필요하다. */
export function isManagedAssetPath(src: string): boolean {
  return MANAGED_ASSET_PATH.test(src);
}

// 같은 asset을 문서 안에서 여러 번 써도 한 번만 받는다. object URL은 탭 수명 동안 유지한다.
const objectUrlCache = new Map<string, Promise<string>>();

/** 관리 이미지를 인증 fetch로 받아 object URL로 돌려준다. 실패한 요청은 캐시에서 지워 다음에 재시도한다. */
export function fetchAssetObjectUrl(path: string): Promise<string> {
  const cached = objectUrlCache.get(path);
  if (cached) return cached;
  const pending = (async () => {
    const response = await apiFetch(path, { cache: "no-store" });
    await throwIfNotOk(response, "이미지를 불러오지 못했습니다.");
    return URL.createObjectURL(await response.blob());
  })();
  objectUrlCache.set(path, pending);
  pending.catch(() => objectUrlCache.delete(path));
  return pending;
}
