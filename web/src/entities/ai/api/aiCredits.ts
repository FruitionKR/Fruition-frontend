import { apiFetch, parseJsonOrThrow } from "@/shared/api/client";
import { sharedText } from "@/shared/i18n/sharedTranslate";

/** 본인 크레딧(milli-KRW). available은 잔액 − 실행 중 예약이고, 실제 사용이 예약보다 크면 음수일 수 있다. */
export type CreditsResponse = {
  currency: string;
  balance_krw_milli: number;
  reserved_krw_milli: number;
  available_krw_milli: number;
};

export async function fetchCredits(): Promise<CreditsResponse> {
  const response = await apiFetch("/api/users/me/credits", { cache: "no-store" });
  return parseJsonOrThrow<CreditsResponse>(response, sharedText("ai.requestFailed.creditsLoad", "크레딧을 불러오지 못했습니다."));
}
