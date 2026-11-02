import assert from "node:assert/strict";
import test from "node:test";
import { notionExportFiles, registerSrcHooks, zipFiles } from "./notionImportFixture.mjs";

registerSrcHooks();
const { formatKrw, milliKrwToWon, estimateLabel, needsIngestConfirmation, runIngestLoop, INGEST_CONFIRM_KRW, INGEST_CONFIRM_DOCUMENTS } =
  await import("../src/features/notion-import/model/importIngest.ts");
const { importErrorMessage, runImport, createRunState } = await import("../src/features/notion-import/model/importRunner.ts");
const { analyzeNotionZip } = await import("../src/features/notion-import/model/analyzeNotionZip.ts");
const { ApiError } = await import("../src/shared/lib/apiErrors.ts");

test("milli-KRW 예상치를 원 단위로 반올림하고 천 단위로 끊어 보여 준다", () => {
  assert.equal(milliKrwToWon(12_339_600), 12_340);
  assert.equal(formatKrw(12_339_600), "약 12,340원");
  assert.equal(formatKrw(499), "약 0원");
  assert.equal(formatKrw(500), "약 1원");
  assert.equal(formatKrw(null), null);
  assert.equal(estimateLabel({ estimated_credits: 150_000, estimated_cost_usd: 0.1 }), "예상 비용 약 150원 (약 $0.10)");
  assert.equal(estimateLabel({ estimated_credits: 150_000, estimated_cost_usd: null }), "예상 비용 약 150원");
  assert.equal(estimateLabel({ estimated_credits: null, estimated_cost_usd: 1.234 }), "예상 비용 약 $1.23");
  assert.equal(estimateLabel({ estimated_credits: null, estimated_cost_usd: null }), "예상 비용을 아직 알 수 없어요");
});

test("예상 금액 5만 원 이상이거나 문서 50개 이상이면 한 번 더 묻는다", () => {
  const estimate = (documents, won) => ({ document_count: documents, estimated_cost_usd: null, estimated_credits: won === null ? null : won * 1000 });
  assert.equal(needsIngestConfirmation(null), false);
  assert.equal(needsIngestConfirmation(estimate(10, 1_000)), false);
  assert.equal(needsIngestConfirmation(estimate(INGEST_CONFIRM_DOCUMENTS - 1, INGEST_CONFIRM_KRW - 1)), false);
  assert.equal(needsIngestConfirmation(estimate(INGEST_CONFIRM_DOCUMENTS, null)), true);
  assert.equal(needsIngestConfirmation(estimate(3, INGEST_CONFIRM_KRW)), true);
});

test("remaining이 0이 될 때까지 20개씩 편입을 요청하고 진행률을 알린다", async () => {
  const responses = [{ queued: 20, remaining: 25 }, { queued: 20, remaining: 5 }, { queued: 5, remaining: 0 }];
  const progress = [];
  let calls = 0;
  const result = await runIngestLoop(async () => responses[calls++], { total: 45, delayMs: 0, onProgress: (value) => progress.push(value) });
  assert.deepEqual(result, { status: "done", queued: 45 });
  assert.equal(calls, 3);
  assert.deepEqual(progress, [{ queued: 0, total: 45 }, { queued: 20, total: 45 }, { queued: 40, total: 45 }, { queued: 45, total: 45 }]);
});

test("AI 사용 한도(429)면 거기서 멈추고 넣은 수와 남은 수를 돌려준다", async () => {
  let calls = 0;
  const result = await runIngestLoop(async () => {
    calls += 1;
    if (calls === 2) throw new ApiError("한도", 429, "AI_USAGE_LIMIT_EXCEEDED");
    return { queued: 20, remaining: 10 };
  }, { total: 30, delayMs: 0 });
  assert.equal(result.status, "limited");
  assert.equal(result.queued, 20);
  assert.equal(result.remaining, 10);
  assert.equal(calls, 2);
});

test("다른 오류나 진전 없는 응답이면 error로 멈춘다", async () => {
  const forbidden = await runIngestLoop(async () => { throw new ApiError("권한 없음", 403, "WORKSPACE_PERMISSION_REQUIRED"); }, { total: 3, delayMs: 0 });
  assert.equal(forbidden.status, "error");
  assert.match(forbidden.message, /권한/);
  const stuck = await runIngestLoop(async () => ({ queued: 0, remaining: 3 }), { total: 3, delayMs: 0 });
  assert.equal(stuck.status, "error");
  assert.equal(stuck.remaining, 3);
});

test("새 오류 코드: IMPORT_NOT_FOUND는 한국어 안내와 함께 가져오기를 멈추고, INVALID_REQUEST는 일반 안내다", async () => {
  assert.equal(importErrorMessage(new ApiError("not found", 404, "IMPORT_NOT_FOUND"), "x"), "가져오기 기록을 찾을 수 없어요. 처음부터 다시 가져와 주세요.");
  assert.equal(importErrorMessage(new ApiError("bad", 400, "INVALID_REQUEST"), "x"), "요청 내용이 올바르지 않아 서버가 받지 않았어요.");
  // 없어진 코드는 따로 다루지 않고 서버 문구를 쓴다.
  assert.equal(importErrorMessage(new ApiError("서버 문구", 400, "IMPORT_TOO_LARGE"), "x"), "서버 문구");

  const plan = await analyzeNotionZip(zipFiles(notionExportFiles()));
  const calls = [];
  const writer = {
    async createFolder(name) { calls.push(name); throw new ApiError("not found", 404, "IMPORT_NOT_FOUND"); },
    async createDocument(name) { calls.push(name); return { id: "d", current_version: 1 }; },
    async saveContent() { return { current_version: 2 }; }
  };
  const result = await runImport(plan, { importId: "imp", writer, state: createRunState() });
  assert.equal(result.fatalMessage, "가져오기 기록을 찾을 수 없어요. 처음부터 다시 가져와 주세요.");
  assert.deepEqual(calls, ["홈"]);
});
