import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });

const { summarizeFailedDocuments } = await import("../src/features/document-notifications/model/failedDocumentsNotice.ts");
const { ko } = await import("./fakeNextIntl.mjs");

/** useDocumentProcessingNotifications가 알림 문구를 만드는 방식과 같다. */
function noticeMessage(summary) {
  const quote = (names) => names.map((name) => `"${name}"`).join(", ");
  if (summary.type === "single") {
    return ko("wiki.notifications.failed.single", { filename: summary.filename, reason: summary.reason ?? ko("wiki.notifications.failed.reasonFallback") });
  }
  const names = summary.restCount > 0
    ? ko("wiki.notifications.failed.namesWithRest", { names: quote(summary.listedFilenames), count: summary.restCount })
    : quote(summary.listedFilenames);
  return ko("wiki.notifications.failed.multiple", { count: summary.count, names });
}

test("실패 1건은 파일명과 실패 사유를 그대로 보여준다", () => {
  const summary = summarizeFailedDocuments([
    { filename: "report.pdf", error_message: "페이지를 추출하지 못했습니다." }
  ]);

  assert.deepEqual(summary, { type: "single", filename: "report.pdf", reason: "페이지를 추출하지 못했습니다." });
  assert.equal(ko("wiki.notifications.failed.title"), "문서 처리 실패");
  assert.equal(noticeMessage(summary), '"report.pdf" 처리에 실패했습니다. 페이지를 추출하지 못했습니다.');
});

test("실패 사유가 없으면 기본 안내 문구로 대체한다", () => {
  const summary = summarizeFailedDocuments([{ filename: "report.pdf" }]);

  assert.equal(summary.reason, null);
  assert.equal(noticeMessage(summary), '"report.pdf" 처리에 실패했습니다. 실패 사유를 확인해 주세요.');
});

test("여러 건 실패는 카드 하나로 묶고 개수와 파일명을 보여준다", () => {
  const summary = summarizeFailedDocuments([
    { filename: "a.pdf", error_message: "이유 A" },
    { filename: "b.pdf", error_message: "이유 B" }
  ]);

  assert.deepEqual(summary, { type: "multiple", count: 2, listedFilenames: ["a.pdf", "b.pdf"], restCount: 0 });
  assert.equal(
    noticeMessage(summary),
    '2개 문서를 처리하지 못했습니다. ("a.pdf", "b.pdf") 실패 사유는 각 문서에서 확인해 주세요.'
  );
});

test("파일명이 많으면 3개까지만 나열하고 나머지는 외 N개로 줄인다", () => {
  const summary = summarizeFailedDocuments(
    ["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"].map((filename) => ({ filename }))
  );

  assert.equal(
    noticeMessage(summary),
    '5개 문서를 처리하지 못했습니다. ("a.pdf", "b.pdf", "c.pdf" 외 2개) 실패 사유는 각 문서에서 확인해 주세요.'
  );
});

test("AI 사용량 한도로 자동 편입을 시작하지 못한 문서는 하루 한도 안내로 보인다", () => {
  const summary = summarizeFailedDocuments([{ filename: "a.pdf", error_message: "AI 사용 한도에 도달해 작업을 시작하지 않았습니다. 잠시 후 또는 내일 다시 시도해 주세요." }]);
  assert.match(noticeMessage(summary), /오늘 사용할 수 있는 AI 사용량을 모두 썼어요/);
});

test("error_code가 AI_USAGE_LIMIT_EXCEEDED면 문구가 달라도 하루 한도 안내로 보인다", () => {
  const summary = summarizeFailedDocuments([{ filename: "a.pdf", error_code: "AI_USAGE_LIMIT_EXCEEDED", error_message: "서버가 바꾼 새 문구" }]);
  assert.equal(noticeMessage(summary), '"a.pdf" 처리에 실패했습니다. 오늘 사용할 수 있는 AI 사용량을 모두 썼어요. 내일 다시 이용해 주세요.');
});
