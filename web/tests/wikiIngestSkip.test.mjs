import assert from "node:assert/strict";
import test from "node:test";
import { translator } from "./helpers/i18nMessages.mjs";

const { WIKI_INGEST_SKIP_REASONS, countWikiIngestSkips, parseWikiIngestSkip } = await import("../src/features/document-upload/model/wikiIngestSkip.ts");

const skipped = (reason) => ({ wiki_ingest: { status: "SKIPPED", reason } });

test("업로드 응답의 wiki_ingest가 SKIPPED이고 알릴 사유일 때만 그 사유를 돌려준다", () => {
  assert.equal(parseWikiIngestSkip(skipped("INSUFFICIENT_CREDIT")), "INSUFFICIENT_CREDIT");
  assert.equal(parseWikiIngestSkip(skipped("AI_USAGE_LIMIT_EXCEEDED")), "AI_USAGE_LIMIT_EXCEEDED");
  assert.equal(parseWikiIngestSkip(skipped("ERROR")), "ERROR");
});

test("필드가 없거나 모르는 값·알릴 필요 없는 사유는 무시한다", () => {
  assert.equal(parseWikiIngestSkip({}), null, "구 서버·멱등 재생·가져오기 세션");
  assert.equal(parseWikiIngestSkip({ wiki_ingest: null }), null);
  assert.equal(parseWikiIngestSkip({ wiki_ingest: "SKIPPED" }), null);
  assert.equal(parseWikiIngestSkip({ wiki_ingest: { status: "QUEUED", reason: null } }), null);
  assert.equal(parseWikiIngestSkip({ wiki_ingest: { status: "NOT_APPLICABLE", reason: null } }), null);
  assert.equal(parseWikiIngestSkip({ wiki_ingest: { status: "skipped", reason: "ERROR" } }), null);
  assert.equal(parseWikiIngestSkip(skipped("DISABLED")), null);
  assert.equal(parseWikiIngestSkip(skipped("PERMISSION")), null);
  assert.equal(parseWikiIngestSkip(skipped(null)), null);
  assert.equal(parseWikiIngestSkip(skipped("SOMETHING_NEW")), null);
});

test("묶음 업로드는 건너뛴 파일을 사유별로 세고, 실패(null)·알리지 않을 응답은 뺀다", () => {
  const results = [
    skipped("INSUFFICIENT_CREDIT"), null, { wiki_ingest: { status: "QUEUED", reason: null } },
    skipped("ERROR"), skipped("INSUFFICIENT_CREDIT"), {}, skipped("PERMISSION")
  ];
  assert.deepEqual(countWikiIngestSkips(results), [{ reason: "INSUFFICIENT_CREDIT", count: 2 }, { reason: "ERROR", count: 1 }]);
  assert.deepEqual(countWikiIngestSkips([null, {}]), []);
});

test("사유마다 ko·en 문구가 있다", () => {
  for (const locale of ["ko", "en"]) {
    const t = translator(locale, "documents.upload");
    for (const reason of WIKI_INGEST_SKIP_REASONS) {
      assert.match(t(`ingestSkipped.single.${reason}`, { filename: "a.md" }), /a\.md/);
      assert.ok(t(`ingestSkipped.reason.${reason}`).length > 0);
    }
  }
  const ko = translator("ko", "documents.upload");
  assert.equal(
    ko("ingestSkipped.batch", { count: 2, reason: ko("ingestSkipped.reason.INSUFFICIENT_CREDIT") }),
    "2개는 위키에 편입되지 않았어요(크레딧 부족)."
  );
  assert.match(ko("ingestSkipped.single.INSUFFICIENT_CREDIT", { filename: "a.md" }), /문서는 올라갔지만 크레딧이 부족해/);
});
