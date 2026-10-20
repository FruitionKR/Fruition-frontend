import { apiFetch, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import type { ModelUsageResponse, UsageRange } from "../model/aiUsage";

/** 로그인 사용자 본인의 이 워크스페이스 모델별 토큰 사용량. 기간은 [from, to)다. 금액은 포함하지 않는다. */
export async function fetchModelUsage(workspaceId: string, { from, to }: UsageRange): Promise<ModelUsageResponse> {
  const query = new URLSearchParams({ from_at: from.toISOString(), to_at: to.toISOString() });
  const response = await apiFetch(`${workspacePath(workspaceId, "usage", "models")}?${query}`, { cache: "no-store" });
  const body = await parseJsonOrThrow<ModelUsageResponse>(response, "AI 사용량을 불러오지 못했습니다.");
  return { ...body, models: Array.isArray(body.models) ? body.models : [] };
}
