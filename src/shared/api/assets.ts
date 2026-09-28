import { apiFetch, throwIfNotOk } from "@/shared/api/client";

// 백엔드가 본문 저장 응답에서 치환해 주는 관리 이미지 경로 (REQ-005)
const MANAGED_ASSET_PATH = /^\/api\/workspaces\/[^/]+\/assets\/[^/]+\/content$/;
const MANAGED_ASSET_PATH_IN_TEXT = /\/api\/workspaces\/[^/\s)]+\/assets\/[^/\s)]+\/content/g;

/** 워크스페이스 멤버만 볼 수 있는 관리 이미지 경로인지. 일반 <img src>로 요청하면 401이라 JWT fetch가 필요하다. */
export function isManagedAssetPath(src: string): boolean {
  return MANAGED_ASSET_PATH.test(src);
}

/** 본문 문자열에 들어 있는 관리 이미지 경로 목록(중복 제거). 편집기를 만들기 전에 미리 받아 두는 데 쓴다. */
export function extractManagedAssetPaths(markdown: string): string[] {
  return [...new Set(markdown.match(MANAGED_ASSET_PATH_IN_TEXT) ?? [])];
}

type AssetEntry = { promise: Promise<string>; url: string | null; refs: number };

// asset 경로별 object URL. 사용처(뷰어 img, 편집기 인스턴스)가 acquire/release로 참조를 세고,
// 마지막 사용처가 놓으면 revoke해 문서를 오래 오가도 blob 메모리가 쌓이지 않게 한다(REQ-005).
const entries = new Map<string, AssetEntry>();

/** 이미 받아 둔 object URL. 없으면 undefined. 편집기 이미지 블록이 첫 렌더에서 원본 경로를 요청하지 않게 동기로 조회한다. */
export function getCachedAssetObjectUrl(path: string): string | undefined {
  return entries.get(path)?.url ?? undefined;
}

/** 이미 진행 중이거나 끝난 요청의 promise. 참조를 늘리지 않는다(같은 사용처가 두 번 잡지 않게 할 때). */
export function peekAssetObjectUrl(path: string): Promise<string> | undefined {
  return entries.get(path)?.promise;
}

/** 관리 이미지를 인증 fetch로 받아 object URL을 돌려주고 참조를 하나 늘린다. 실패한 요청은 지워 다음에 재시도한다. */
export function acquireAssetObjectUrl(path: string): Promise<string> {
  const existing = entries.get(path);
  if (existing) {
    existing.refs += 1;
    return existing.promise;
  }
  const entry: AssetEntry = { promise: Promise.resolve(""), url: null, refs: 1 };
  entry.promise = (async () => {
    const response = await apiFetch(path, { cache: "no-store" });
    await throwIfNotOk(response, "이미지를 불러오지 못했습니다.");
    const url = URL.createObjectURL(await response.blob());
    // 기다리는 동안 모두 놓았으면 바로 정리한다. 그 사이 같은 경로로 새 엔트리가 생겼을 수 있으니 자기 것일 때만 지운다.
    if (entry.refs <= 0) {
      URL.revokeObjectURL(url);
      if (entries.get(path) === entry) entries.delete(path);
      return url;
    }
    entry.url = url;
    return url;
  })();
  entry.promise.catch(() => { if (entries.get(path) === entry) entries.delete(path); });
  entries.set(path, entry);
  return entry.promise;
}

/** 참조를 하나 놓는다. 마지막이면 object URL을 revoke한다. */
export function releaseAssetObjectUrl(path: string): void {
  const entry = entries.get(path);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  if (entry.url) URL.revokeObjectURL(entry.url);
  if (entries.get(path) === entry) entries.delete(path);
}

/** 하위 호환: 참조 계수 없이 받기만 한다(탭 수명 동안 유지). 새 코드는 acquire/release를 쓴다. */
export function fetchAssetObjectUrl(path: string): Promise<string> {
  return acquireAssetObjectUrl(path);
}
