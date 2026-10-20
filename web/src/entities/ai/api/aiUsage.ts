import { apiFetch, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import type { ChargeSummaryResponse, ModelUsageResponse, UsageRange } from "../model/aiUsage";

/** 로그인 사용자 본인의 이 워크스페이스 모델별 토큰 사용량. 기간은 [from, to)다. 금액은 포함하지 않는다. */
export async function fetchModelUsage(workspaceId: string, { from, to }: UsageRange): Promise<ModelUsageResponse> {
  const query = new URLSearchParams({ from_at: from.toISOString(), to_at: to.toISOString() });
  const response = await apiFetch(`${workspacePath(workspaceId, "usage", "models")}?${query}`, { cache: "no-store" });
  const body = await parseJsonOrThrow<ModelUsageResponse>(response, "AI 사용량을 불러오지 못했습니다.");
  return { ...body, models: Array.isArray(body.models) ? body.models : [] };
}

/** 로그인 사용자 본인의 호출 청구 금액(부가세 포함 milli-KRW). 모든 워크스페이스를 합친 응답 모델별 값이다. 기간은 [from, to)다. */
export async function fetchUsageCharges({ from, to }: UsageRange): Promise<ChargeSummaryResponse> {
  const query = new URLSearchParams({ from_at: from.toISOString(), to_at: to.toISOString() });
  const response = await apiFetch(`/api/users/me/usage/charges?${query}`, { cache: "no-store" });
  const body = await parseJsonOrThrow<ChargeSummaryResponse>(response, "AI 사용 금액을 불러오지 못했습니다.");
  return { ...body, models: Array.isArray(body.models) ? body.models : [] };
}
