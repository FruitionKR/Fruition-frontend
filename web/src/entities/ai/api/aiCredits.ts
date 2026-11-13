import { apiFetch, parseJsonOrThrow } from "@/shared/api/client";
import { sharedText } from "@/shared/i18n/sharedTranslate";

export type CreditEntry = {
  type: string;
  amount_krw_milli: number;
  run_id: string | null;
  reason: string | null;
  created_at: string;
};

export type ChargeUsage = {
  workspace_id: string | null;
  kind: string | null;
  provider: string | null;
  model: string | null;
  calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  cache_creation_tokens: number | null;
  audio_seconds: number | null;
  tts_characters: number | null;
  amount_krw_milli: number;
  started_at: string;
  last_started_at: string;
};

export type ChargeHistory = {
  id: number;
  run_id: string | null;
  reason: string | null;
  amount_krw_milli: number;
  charged_at: string;
  usage: ChargeUsage[];
};

/** 본인 크레딧(milli-KRW). available은 잔액 − 실행 중 예약이고, 실제 사용이 예약보다 크면 음수일 수 있다. */
export type CreditsResponse = {
  /** 최근 원장 50건. 예약·해제도 포함하므로 전체 사용 내역은 아니다. */
  entries?: CreditEntry[];
  /** 최근 차감 실행 50건. 같은 실행의 모든 차감분을 합산한다. */
  charge_history?: ChargeHistory[];
  currency: string;
  balance_krw_milli: number;
  reserved_krw_milli: number;
  available_krw_milli: number;
  /** 잔액 제한을 받지 않는 기존 가입자. 화면은 크레딧을 숨긴다. 구버전 서버는 보내지 않는다. */
  limit_exempt?: boolean;
};

export async function fetchCredits(): Promise<CreditsResponse> {
  const response = await apiFetch("/api/users/me/credits", { cache: "no-store" });
  return parseJsonOrThrow<CreditsResponse>(response, sharedText("ai.requestFailed.creditsLoad", "크레딧을 불러오지 못했습니다."));
}
