import { apiFetch, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import { sharedText } from "@/shared/i18n/sharedTranslate";
import { parseStorageUsage, type StorageUsageResponse } from "@/entities/workspace/model/storageUsage";

/** 내 저장 공간 사용량. 워크스페이스 경로지만 값은 사용자 단위(모든 워크스페이스 합산)다. */
export async function fetchStorageUsage(workspaceId: string): Promise<StorageUsageResponse> {
  const response = await apiFetch(workspacePath(workspaceId, "storage"), { cache: "no-store" });
  const storage = parseStorageUsage(await parseJsonOrThrow<unknown>(response, sharedText("workspace.requestFailed.storageLoad", "저장 공간 사용량을 불러오지 못했습니다.")));
  if (!storage) throw new Error(sharedText("workspace.requestFailed.storageInvalid", "저장 공간 사용량 응답이 올바르지 않습니다."));
  return storage;
}
