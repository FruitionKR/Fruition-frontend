/**
 * 가져온 문서의 위키 편입. 서버는 요청 한 번에 20개까지 큐에 넣고 남은 수(remaining)를 돌려주므로 0이 될 때까지 다시 부른다.
 * 예상 비용(milli-KRW)을 원 단위로 보여 주고, 크면 한 번 더 묻는다.
 */
import { ApiError, AI_USAGE_LIMIT_EXCEEDED_CODE } from "@/shared/lib/apiErrors";
import { importErrorMessage } from "./importRunner";

/** 편입 요청 사이 간격. 서버 큐·AI 한도에 몰리지 않게 조금 쉰다. */
export const INGEST_REQUEST_DELAY_MS = 1500;
/** 이 금액(원) 이상이면 편입 전에 한 번 더 묻는다. */
export const INGEST_CONFIRM_KRW = 50_000;
/** 이 문서 수 이상이면 편입 전에 한 번 더 묻는다. */
export const INGEST_CONFIRM_DOCUMENTS = 50;

export type IngestEstimate = { document_count: number; estimated_cost_usd: number | null; estimated_credits: number | null };

/** milli-KRW → 원(반올림). 값이 없으면 null */
export function milliKrwToWon(milli: number | null | undefined): number | null {
  return typeof milli === "number" && Number.isFinite(milli) ? Math.round(milli / 1000) : null;
}

/** "약 12,340원". 값이 없으면 null */
export function formatKrw(milli: number | null | undefined): string | null {
  const won = milliKrwToWon(milli);
  return won === null ? null : `약 ${won.toLocaleString("ko-KR")}원`;
}

/** 예상 비용 한 줄. 원화를 앞에, USD가 있으면 괄호로 덧붙인다. */
export function estimateLabel(estimate: Pick<IngestEstimate, "estimated_cost_usd" | "estimated_credits">): string {
  const krw = formatKrw(estimate.estimated_credits);
  const usd = typeof estimate.estimated_cost_usd === "number" ? `약 $${estimate.estimated_cost_usd.toFixed(2)}` : null;
  if (krw && usd) return `예상 비용 ${krw} (${usd})`;
  if (krw ?? usd) return `예상 비용 ${krw ?? usd}`;
  return "예상 비용을 아직 알 수 없어요";
}

/**
 * PDF 변환 예상치 한 줄. 서버 값은 예약 상한(변환 1건 상한 × 수)이라 "최대"로 보여 준다. 예: "최대 약 1,000원 (약 $0.70)"
 */
export function maxEstimateLabel(estimate: Pick<IngestEstimate, "estimated_cost_usd" | "estimated_credits">): string {
  const krw = formatKrw(estimate.estimated_credits);
  const usd = typeof estimate.estimated_cost_usd === "number" ? `약 $${estimate.estimated_cost_usd.toFixed(2)}` : null;
  if (krw && usd) return `최대 ${krw} (${usd})`;
  if (krw ?? usd) return `최대 ${krw ?? usd}`;
  return "예상 비용을 아직 알 수 없어요";
}

/** PDF 변환 비용 안내. 상한과 실제 비용의 차이를 알린다. */
export const CONVERT_COST_HINT = "실제 비용은 대부분 이보다 적어요. 글자가 깨진 페이지만 AI로 고쳐요.";

/** 편입 전에 비용 확인을 한 번 더 받아야 하는지 */
export function needsIngestConfirmation(estimate: IngestEstimate | null): boolean {
  if (!estimate) return false;
  const won = milliKrwToWon(estimate.estimated_credits);
  return estimate.document_count >= INGEST_CONFIRM_DOCUMENTS || (won !== null && won >= INGEST_CONFIRM_KRW);
}

export type IngestProgress = { queued: number; total: number };

export type IngestResult =
  | { status: "done"; queued: number }
  /** AI 사용 한도(429)로 멈췄다. 나머지는 나중에 다시 시도한다 */
  | { status: "limited"; queued: number; remaining: number | null; message: string }
  | { status: "error"; queued: number; remaining: number | null; message: string };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 가져온 PDF 변환 예상치를 편입 예상치 모양으로 바꾼다(같은 비용 표시·확인 규칙을 쓴다). 변환할 PDF가 없으면 null */
export function convertEstimateOf(estimate: {
  pdf_unconverted_count?: number;
  convert_estimated_cost_usd?: number | null;
  convert_estimated_credits?: number | null;
} | null): IngestEstimate | null {
  const count = estimate?.pdf_unconverted_count ?? 0;
  if (count <= 0) return null;
  return { document_count: count, estimated_cost_usd: estimate?.convert_estimated_cost_usd ?? null, estimated_credits: estimate?.convert_estimated_credits ?? null };
}

/** 편입·변환 루프의 오류 문구 */
export type LoopMessages = { failed: string; stalled: string };

const INGEST_MESSAGES: LoopMessages = {
  failed: "위키 편입을 요청하지 못했어요.",
  stalled: "남은 문서를 위키 편입 대기열에 넣지 못했어요. 잠시 뒤 다시 시도해 주세요."
};

export const CONVERT_MESSAGES: LoopMessages = {
  failed: "PDF 변환을 요청하지 못했어요.",
  stalled: "남은 PDF를 변환 대기열에 넣지 못했어요. 잠시 뒤 다시 시도해 주세요."
};

/**
 * remaining이 0이 될 때까지 편입(또는 PDF 변환)을 요청한다. 오류가 나면 거기서 멈추고 그때까지 넣은 수를 돌려준다.
 * total은 진행 표시의 분모(예상치의 문서 수)이며, 서버가 알려 준 남은 수로 고쳐 간다.
 */
export async function runIngestLoop(
  ingestOnce: () => Promise<{ queued: number; remaining: number }>,
  { total, onProgress, delayMs = INGEST_REQUEST_DELAY_MS, messages = INGEST_MESSAGES }:
    { total: number; onProgress?: (progress: IngestProgress) => void; delayMs?: number; messages?: LoopMessages }
): Promise<IngestResult> {
  let queued = 0;
  let remaining: number | null = null;
  onProgress?.({ queued, total });
  for (;;) {
    let response: { queued: number; remaining: number };
    try {
      response = await ingestOnce();
    } catch (error) {
      const isLimit = error instanceof ApiError && (error.status === 429 || error.code === AI_USAGE_LIMIT_EXCEEDED_CODE);
      const message = importErrorMessage(error, messages.failed);
      return isLimit ? { status: "limited", queued, remaining, message } : { status: "error", queued, remaining, message };
    }
    queued += response.queued;
    remaining = response.remaining;
    onProgress?.({ queued, total: queued + remaining });
    if (remaining <= 0) return { status: "done", queued };
    // 남았는데 하나도 넣지 못하면 다시 불러도 같다. 멈추고 알린다.
    if (response.queued <= 0) return { status: "error", queued, remaining, message: messages.stalled };
    await wait(delayMs);
  }
}
