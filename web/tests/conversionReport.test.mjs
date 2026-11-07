import assert from "node:assert/strict";
import test from "node:test";
import { koT } from "./koMessages.mjs";
import { registerSrcHooks } from "./notionImportFixture.mjs";

registerSrcHooks();
const { getConversionReportView, fallbackReason } = await import("../src/entities/document/lib/conversionReport.ts");
const t = koT("documents.preview.conversionReport");
const reasonText = (reason) => t(`reasons.${reason}`);

test("요약이 없거나 대신한 쪽·그림 설명 요청이 없으면 안내하지 않는다", () => {
  assert.equal(getConversionReportView(undefined), null);
  assert.equal(getConversionReportView({}), null);
  assert.equal(getConversionReportView({
    restoration_summary: { broken_pages: 2, repaired_pages: 2, fallback_pages: [] },
    figure_descriptions: { requested: false, described: 0, failed: 0, skipped: 3 }
  }), null);
});

test("원문으로 대신한 쪽 수와 쪽별 사유를 한국어로 보이고 대표 사유가 아닌 causes를 덧붙인다", () => {
  const view = getConversionReportView({
    restoration_summary: {
      broken_pages: 3,
      repaired_pages: 1,
      fallback_pages: [
        { page: 22, reason: "repair_rejected", causes: ["font_mapping", "repair_rejected"] },
        { page: 4, reason: "provider_error" },
        { page: 9, reason: "mystery" }
      ]
    }
  });

  assert.equal(view.fallbackPageCount, 3);
  assert.equal(t("fallbackTitle", { count: view.fallbackPageCount }), "3개 페이지는 원문 텍스트로 대신했어요");
  assert.deepEqual(view.pages, [
    { page: 4, reason: "provider_error", causes: [] },
    { page: 9, reason: "unknown", causes: [] },
    { page: 22, reason: "repair_rejected", causes: ["font_mapping"] }
  ]);
  assert.deepEqual(view.pages.map(({ reason, causes }) => [reasonText(reason), ...causes.map(reasonText)]), [
    ["AI 복원 요청 실패"],
    ["알 수 없는 이유"],
    ["AI 복원 결과가 원문과 달라 사용하지 않음", "글꼴을 읽지 못함"]
  ]);
  assert.equal(view.figures, null);
});

test("사유 코드 문구", () => {
  assert.deepEqual(
    ["font_mapping", "replacement_character", "token_mismatch", "extract_failed"].map(fallbackReason).map(reasonText),
    ["글꼴을 읽지 못함", "깨진 글자가 있음", "표·수식 위치가 맞지 않음", "글자를 뽑지 못함"]
  );
});

test("그림 설명을 요청했으면 집계를 보인다(실패·건너뜀은 있을 때만)", () => {
  assert.deepEqual(getConversionReportView({ figure_descriptions: { requested: true, described: 4, failed: 1, skipped: 2 } }).figures,
    { described: 4, failed: 1, skipped: 2 });
  assert.equal([t("figures.described", { count: 4 }), t("figures.failed", { count: 1 }), t("figures.skipped", { count: 2 })].join(" · "),
    "그림 4개에 설명을 붙였어요 · 1개 실패 · 2개는 건너뜀");
  const only = getConversionReportView({ figure_descriptions: { requested: true, described: 2, failed: 0, skipped: 0 } });
  assert.deepEqual(only.figures, { described: 2, failed: 0, skipped: 0 });
  assert.equal(only.fallbackPageCount, 0);
});
