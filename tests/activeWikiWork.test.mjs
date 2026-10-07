import assert from "node:assert/strict";
import test from "node:test";
import {
  isWikiReflectEligible,
  selectActiveIngestDocuments
} from "../src/features/wiki-ingest/model/wikiReflectState.ts";
import { formatLintProgressLabel } from "../src/features/wiki-ingest/model/activeLintOperation.ts";
import { getWikiWorkPollInterval, isStaleForIdlePoll } from "../src/features/wiki-ingest/model/wikiWorkPolling.ts";
import { nextOperationPollDelay } from "../src/features/document-notifications/model/operationPolling.ts";

function makeDocument(overrides) {
  return {
    id: "doc-1",
    filename: "note.md",
    mime_type: "text/markdown",
    byte_size: 10,
    status: "completed",
    source_uri: "s3://bucket/doc-1",
    uploaded_at: "2026-08-16T00:00:00Z",
    document_role: "EDITABLE",
    ...overrides
  };
}

function makeLog(overrides) {
  return {
    operation_id: "op_1",
    operation_type: "lint",
    status: "processing",
    target_document_id: null,
    summary: null,
    changed_resource_count: 0,
    restored_from: null,
    created_at: "2026-08-17T00:00:00Z",
    completed_at: null,
    ...overrides
  };
}

test("진행 중인 문서를 모두 돌려준다", () => {
  const documents = [
    makeDocument({ id: "doc-1", filename: "a.pdf", status: "processing" }),
    makeDocument({ id: "doc-2", filename: "b.md", processing_state: "running" }),
    makeDocument({ id: "doc-3", filename: "c.md", status: "completed" })
  ];
  assert.deepEqual(
    selectActiveIngestDocuments(documents).map((document) => document.filename),
    ["a.pdf", "b.md"]
  );
});

test("진행 중인 문서가 없으면 빈 목록이다", () => {
  const documents = [
    makeDocument({ status: "uploaded" }),
    makeDocument({ id: "doc-2", status: "failed" })
  ];
  assert.deepEqual(selectActiveIngestDocuments(documents), []);
});

test("heartbeat가 끊긴 stalled 문서도 진행 중으로 본다", () => {
  const stalled = makeDocument({ filename: "stalled.md", processing_state: "stalled" });
  assert.deepEqual(
    selectActiveIngestDocuments([stalled]).map((document) => document.filename),
    ["stalled.md"]
  );
});

test("stalled 문서는 반영 요청을 다시 받지 않는다", () => {
  const stalled = makeDocument({ processing_state: "stalled", needs_reingest: true });
  assert.equal(isWikiReflectEligible(stalled), false);
});

test("진행 중인 lint 로그가 있으면 진행 라벨을 만든다", () => {
  assert.equal(
    formatLintProgressLabel(makeLog({ created_at: "2026-08-17T00:00:00Z" }), false,
      Date.parse("2026-08-17T00:04:20Z")),
    "Lint · 4분째 실행 중"
  );
});

test("로그가 아직 안 보여도 방금 보낸 요청은 진행 중으로 표시한다", () => {
  assert.equal(formatLintProgressLabel(null, true), "Lint 진행 중");
});

test("진행 중인 lint가 없으면 라벨이 없다", () => {
  assert.equal(formatLintProgressLabel(null, false), null);
});

test("활성 작업이 없어도 저빈도 polling을 유지한다", () => {
  assert.equal(getWikiWorkPollInterval(false), 15_000);
  assert.equal(getWikiWorkPollInterval(true), 3_000);
});

test("숨김 탭은 진행 중 작업이 있을 때만 느린 주기로 폴링한다", () => {
  assert.equal(getWikiWorkPollInterval(true, false), 30_000);
  assert.equal(getWikiWorkPollInterval(true, true), 3_000);
  assert.equal(getWikiWorkPollInterval(false, false), false);
  assert.equal(getWikiWorkPollInterval(false, true), 15_000);
});

test("탭 복귀 시 평소 폴링 주기 이상 지난 데이터만 다시 받는다", () => {
  assert.equal(isStaleForIdlePoll(100_000, 114_999), false);
  assert.equal(isStaleForIdlePoll(100_000, 115_000), true);
});

test("작업 알림 폴링은 진행 중 작업이 없는 숨김 탭에서 멈추고, 있으면 숨김 탭에서 느리게 돈다", () => {
  assert.equal(nextOperationPollDelay(true, true), 30_000);
  assert.equal(nextOperationPollDelay(true, false), 3_000);
  assert.equal(nextOperationPollDelay(false, false), 15_000);
  assert.equal(nextOperationPollDelay(false, true), null);
});
