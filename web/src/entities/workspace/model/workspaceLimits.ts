import { ApiError } from "@/shared/lib/apiErrors";

/** 워크스페이스 요금제. 용량은 플랜별로 서버가 정하고 storage 응답으로 내려 준다. */
export type WorkspacePlan = "FREE" | "PRO" | "TEAM";

/** GET /api/workspaces/{id}/storage 응답 */
export type WorkspaceStorageResponse = {
  plan: WorkspacePlan;
  used_bytes: number;
  limit_bytes: number;
};

const STORAGE_QUOTA_MESSAGE = "워크스페이스 저장 공간이 부족합니다. 사용하지 않는 문서를 삭제한 뒤 다시 올려 주세요.";

/**
 * 업로드 전에 파일별로 남은 용량을 검사한다. 통과하면 null, 막히면 안내 문구를 돌려준다.
 * 파일 하나의 크기는 제한하지 않는다. 앞 파일이 통과하면 그 크기만큼 남은 용량을 줄여,
 * 여러 파일을 한 번에 올려도 용량을 넘지 않게 한다. 서버도 같은 검사를 하므로 이 검사는 빠른 안내용이다.
 */
export function checkStorageQuota(fileSizes: number[], storage: WorkspaceStorageResponse): (string | null)[] {
  let remaining = storage.limit_bytes - storage.used_bytes;
  return fileSizes.map((size) => {
    if (size > remaining) return STORAGE_QUOTA_MESSAGE;
    remaining -= size;
    return null;
  });
}

/** 서버 제한 에러 code별 안내 문구. 서버 message 대신 정해 둔 문구로 안내한다. */
const LIMIT_ERROR_MESSAGES: Record<string, string> = {
  STORAGE_QUOTA_EXCEEDED: STORAGE_QUOTA_MESSAGE,
  WORKSPACE_LIMIT_EXCEEDED: "무료 워크스페이스를 더 만들 수 없습니다. 사용하지 않는 워크스페이스를 삭제한 뒤 다시 시도해 주세요."
};

/** 용량·개수 제한 에러면 안내 문구를, 아니면 null을 돌려준다. */
export function describeLimitError(error: unknown): string | null {
  if (!(error instanceof ApiError) || !error.code) return null;
  return LIMIT_ERROR_MESSAGES[error.code] ?? null;
}

/** 무료 워크스페이스를 더 만들 수 없는지. 한도(null)가 없거나 서버가 값을 주지 않으면 막지 않는다. */
export function isFreeWorkspaceLimitReached(count: number | undefined, limit: number | null | undefined): boolean {
  return typeof count === "number" && typeof limit === "number" && count >= limit;
}
