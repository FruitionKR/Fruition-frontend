import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });

const {
  INGEST_PROGRESS_CEILING,
  INGEST_PROGRESS_TAU_MS,
  INGEST_FINISH_DURATION_MS,
  INGEST_FINISH_HOLD_MS,
  simulatedIngestProgress,
  finishingIngestProgress,
  reconcileIngestProgress,
  ingestProgressAt,
  ingestProgressByNodeId
} = await import("../src/widgets/graph/lib/graphIngestProgress.ts");
const { selectGraphIngestProgressInputs } = await import("../src/features/wiki-ingest/model/graphIngestProgressInputs.ts");

const T0 = Date.parse("2026-10-08T00:00:00Z");
const processing = (nodeId, startedAt) => ({ nodeId, status: "processing", startedAt });

test("연출 진행률은 0에서 시작해 천천히 오르고 상한(92%)에 닿지 않는다", () => {
  assert.equal(simulatedIngestProgress(0), 0);
  assert.equal(simulatedIngestProgress(-500), 0);
  const atTau = simulatedIngestProgress(INGEST_PROGRESS_TAU_MS);
  assert.ok(Math.abs(atTau - INGEST_PROGRESS_CEILING * (1 - Math.exp(-1))) < 1e-9);
  assert.ok(simulatedIngestProgress(10_000) < simulatedIngestProgress(20_000));
  const longRun = simulatedIngestProgress(60 * 60 * 1000);
  assert.ok(longRun <= INGEST_PROGRESS_CEILING && longRun < 1);
});

test("완료 보간은 시작 값에서 600ms 동안 ease-out으로 100%까지 채운다", () => {
  assert.equal(finishingIngestProgress(0.4, 0), 0.4);
  const half = finishingIngestProgress(0.4, INGEST_FINISH_DURATION_MS / 2);
  // ease-out: 시간 절반에서 이미 남은 거리의 절반보다 많이 채운다.
  assert.ok(half > 0.7 && half < 1);
  assert.equal(finishingIngestProgress(0.4, INGEST_FINISH_DURATION_MS), 1);
  assert.equal(finishingIngestProgress(0.4, INGEST_FINISH_DURATION_MS + INGEST_FINISH_HOLD_MS), 1);
});

test("처음 보는 처리 중 문서는 processing_started_at 기준으로 이어서 진행한다", () => {
  const entries = reconcileIngestProgress({}, [processing("raw:a", new Date(T0 - 20_000).toISOString())], T0);
  assert.deepEqual(entries["raw:a"], { phase: "running", startedAtMs: T0 - 20_000 });
  assert.ok(Math.abs(ingestProgressAt(entries["raw:a"], T0) - simulatedIngestProgress(20_000)) < 1e-9);
});

test("시작 시각이 없거나 잘못됐거나 미래면 지금부터 시작한다", () => {
  const entries = reconcileIngestProgress({}, [
    processing("raw:a", undefined),
    processing("raw:b", "not-a-date"),
    processing("raw:c", new Date(T0 + 5_000).toISOString())
  ], T0);
  for (const id of ["raw:a", "raw:b", "raw:c"]) assert.equal(entries[id].startedAtMs, T0);
});

test("이미 진행 중인 항목은 폴링으로 다시 들어와도 시작 시각을 유지하고 이전 객체를 바꾸지 않는다", () => {
  const first = reconcileIngestProgress({}, [processing("raw:a", undefined)], T0);
  const snapshot = structuredClone(first);
  const second = reconcileIngestProgress(first, [processing("raw:a", new Date(T0 - 60_000).toISOString())], T0 + 3_000);
  assert.equal(second["raw:a"].startedAtMs, T0);
  assert.deepEqual(first, snapshot);
});

test("처리 중이던 문서가 목록에서 빠지면(완료) 현재 값에서 채우기 단계로 넘어간다", () => {
  const running = reconcileIngestProgress({}, [processing("raw:a", new Date(T0).toISOString())], T0);
  const finishing = reconcileIngestProgress(running, [], T0 + 10_000);
  assert.equal(finishing["raw:a"].phase, "finishing");
  assert.equal(finishing["raw:a"].finishStartedAtMs, T0 + 10_000);
  assert.ok(Math.abs(finishing["raw:a"].fromProgress - simulatedIngestProgress(10_000)) < 1e-9);
  assert.ok(Math.abs(ingestProgressAt(finishing["raw:a"], T0 + 10_000) - simulatedIngestProgress(10_000)) < 1e-9);
  assert.equal(ingestProgressAt(finishing["raw:a"], T0 + 10_000 + INGEST_FINISH_DURATION_MS), 1);
});

test("채우기와 100% 유지가 끝나면 항목을 지워 일반 노드로 돌아간다", () => {
  const running = reconcileIngestProgress({}, [processing("raw:a", undefined)], T0);
  const finishing = reconcileIngestProgress(running, [], T0 + 1_000);
  const holding = reconcileIngestProgress(finishing, [], T0 + 1_000 + INGEST_FINISH_DURATION_MS + INGEST_FINISH_HOLD_MS - 1);
  assert.equal(holding["raw:a"].phase, "finishing");
  const done = reconcileIngestProgress(holding, [], T0 + 1_000 + INGEST_FINISH_DURATION_MS + INGEST_FINISH_HOLD_MS);
  assert.deepEqual(done, {});
});

test("실패한 문서는 100%로 채우지 않고 바로 지운다", () => {
  const running = reconcileIngestProgress({}, [processing("raw:a", undefined)], T0);
  const failed = reconcileIngestProgress(running, [{ nodeId: "raw:a", status: "failed" }], T0 + 2_000);
  assert.deepEqual(failed, {});
  // 진행 중이던 적이 없는 실패 문서는 무시한다.
  assert.deepEqual(reconcileIngestProgress({}, [{ nodeId: "raw:b", status: "failed" }], T0), {});
});

test("동작 줄이기에서는 완료 즉시 일반 노드로 돌아간다", () => {
  const running = reconcileIngestProgress({}, [processing("raw:a", undefined)], T0);
  assert.deepEqual(reconcileIngestProgress(running, [], T0 + 2_000, { reduceMotion: true }), {});
});

test("채우는 중에 다시 편입이 시작되면 새로 진행한다", () => {
  const running = reconcileIngestProgress({}, [processing("raw:a", undefined)], T0);
  const finishing = reconcileIngestProgress(running, [], T0 + 1_000);
  const restarted = reconcileIngestProgress(finishing, [processing("raw:a", undefined)], T0 + 1_200);
  assert.deepEqual(restarted["raw:a"], { phase: "running", startedAtMs: T0 + 1_200 });
});

test("노드별 진행률 맵을 만든다", () => {
  const entries = reconcileIngestProgress({}, [processing("raw:a", undefined)], T0);
  const map = ingestProgressByNodeId(entries, T0 + INGEST_PROGRESS_TAU_MS);
  assert.deepEqual([...map.keys()], ["raw:a"]);
  assert.ok(Math.abs(map.get("raw:a") - simulatedIngestProgress(INGEST_PROGRESS_TAU_MS)) < 1e-9);
});

test("문서 목록에서 위키 편입 중·실패 문서만 raw 노드 입력으로 만든다(PDF 변환 중은 제외)", () => {
  const base = { mime_type: "text/markdown", document_role: "EDITABLE", filename: "a.md" };
  const docs = [
    { ...base, id: "ing", status: "processing", processing_started_at: "2026-10-08T00:00:00Z", pipeline_run_id: "ingest:1" },
    { ...base, id: "stalled", status: "completed", processing_state: "stalled" },
    { ...base, id: "conv", status: "processing", pipeline_run_id: "convert:1" },
    { ...base, id: "fail", status: "failed", pipeline_run_id: "ingest:2" },
    { ...base, id: "done", status: "completed", pipeline_run_id: "ingest:3" }
  ];
  assert.deepEqual(selectGraphIngestProgressInputs(docs), [
    { nodeId: "raw:ing", status: "processing", startedAt: "2026-10-08T00:00:00Z" },
    { nodeId: "raw:stalled", status: "processing", startedAt: undefined },
    { nodeId: "raw:fail", status: "failed" }
  ]);
});
