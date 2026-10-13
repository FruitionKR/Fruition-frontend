import type { GraphIngestProgressInput } from "@/features/wiki-ingest/model/graphIngestProgressInputs";

/**
 * 생성 중 노드의 연출형 진행률.
 * 실제 진행률이 아니라, 편입 시작부터 천천히 오르다(상한에 점근) 완료 신호가 오면 빠르게 100%를 채운다.
 */

/** 진행 중에 도달할 수 있는 상한. 완료 신호 전에는 100%가 되지 않는다. */
export const INGEST_PROGRESS_CEILING = 0.92;
/** 진행률 곡선 시간 상수(ms). τ에서 상한의 약 63%(≈58%)에 이른다. */
export const INGEST_PROGRESS_TAU_MS = 20_000;
/** 완료 신호 후 100%까지 채우는 시간(ms) */
export const INGEST_FINISH_DURATION_MS = 600;
/** 100%를 보여준 채 유지하는 시간(ms) */
export const INGEST_FINISH_HOLD_MS = 400;

export type IngestProgressEntry =
  | { phase: "running"; startedAtMs: number }
  | { phase: "finishing"; fromProgress: number; finishStartedAtMs: number };

export type IngestProgressEntries = Readonly<Record<string, IngestProgressEntry>>;

/** p(t) = 상한 · (1 − e^(−t/τ)) */
export function simulatedIngestProgress(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return INGEST_PROGRESS_CEILING * (1 - Math.exp(-elapsedMs / INGEST_PROGRESS_TAU_MS));
}

/** 완료 후 fromProgress → 1 을 ease-out(cubic)으로 보간한다. */
export function finishingIngestProgress(fromProgress: number, elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / INGEST_FINISH_DURATION_MS));
  if (t >= 1) return 1;
  const eased = 1 - (1 - t) ** 3;
  return fromProgress + (1 - fromProgress) * eased;
}

export function ingestProgressAt(entry: IngestProgressEntry, nowMs: number): number {
  return entry.phase === "running"
    ? simulatedIngestProgress(nowMs - entry.startedAtMs)
    : finishingIngestProgress(entry.fromProgress, nowMs - entry.finishStartedAtMs);
}

/** 서버 시작 시각을 쓰되, 없거나 잘못됐거나 미래(시계 오차)면 지금부터 시작한다. */
function resolveStartedAtMs(startedAt: string | undefined, nowMs: number): number {
  const parsed = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isFinite(parsed) ? Math.min(parsed, nowMs) : nowMs;
}

/**
 * 이전 항목과 현재 문서 상태로 다음 항목을 만든다(입력은 바꾸지 않는다).
 * - processing: 진행 중 항목은 시작 시각 유지, 없거나 채우는 중이었으면 새로 시작
 * - 진행 중이던 문서가 목록에서 빠짐(완료): 현재 값에서 채우기 단계로. 동작 줄이기면 바로 제거
 * - failed: 채우지 않고 바로 제거
 * - 채우기 + 유지 시간이 지난 항목은 제거
 */
export function reconcileIngestProgress(
  previous: IngestProgressEntries,
  inputs: readonly GraphIngestProgressInput[],
  nowMs: number,
  { reduceMotion = false }: { reduceMotion?: boolean } = {}
): IngestProgressEntries {
  const inputById = new Map(inputs.map((input) => [input.nodeId, input]));
  const next: Record<string, IngestProgressEntry> = {};

  for (const input of inputs) {
    if (input.status !== "processing") continue;
    const current = previous[input.nodeId];
    next[input.nodeId] = current?.phase === "running"
      ? current
      : { phase: "running", startedAtMs: resolveStartedAtMs(input.startedAt, nowMs) };
  }

  for (const [nodeId, entry] of Object.entries(previous)) {
    if (next[nodeId]) continue;
    if (inputById.get(nodeId)?.status === "failed") continue;
    if (entry.phase === "running") {
      if (reduceMotion) continue;
      next[nodeId] = { phase: "finishing", fromProgress: ingestProgressAt(entry, nowMs), finishStartedAtMs: nowMs };
      continue;
    }
    if (nowMs - entry.finishStartedAtMs < INGEST_FINISH_DURATION_MS + INGEST_FINISH_HOLD_MS) next[nodeId] = entry;
  }

  return next;
}

export function ingestProgressByNodeId(entries: IngestProgressEntries, nowMs: number): Map<string, number> {
  return new Map(Object.entries(entries).map(([nodeId, entry]) => [nodeId, ingestProgressAt(entry, nowMs)]));
}
