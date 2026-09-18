import assert from "node:assert/strict";
import test from "node:test";
import { buildWikiWorkRows, formatWorkStartTime } from "../src/features/wiki-ingest/model/wikiWorkList.ts";

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

/** 타임존에 안 흔들리게 로컬 시각으로 기대값을 만든다 */
function localHHMM(iso) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

test("시작 시각을 로컬 HH:MM으로 만든다", () => {
  const iso = "2026-08-17T05:07:00Z";
  assert.equal(formatWorkStartTime(iso), localHHMM(iso));
  assert.match(formatWorkStartTime(iso), /^\d{2}:\d{2}$/);
});

test("시작 시각이 없거나 깨졌으면 --:--", () => {
  assert.equal(formatWorkStartTime(undefined), "--:--");
  assert.equal(formatWorkStartTime("not-a-date"), "--:--");
});

test("진행 중인 ingest 문서를 파일명·시작 시각 행으로 만든다", () => {
  const rows = buildWikiWorkRows([
    makeDocument({ id: "a", filename: "a.md", status: "processing", processing_started_at: "2026-08-17T01:02:00Z" }),
    makeDocument({ id: "b", filename: "b.md", processing_state: "running" })
  ], null);
  assert.deepEqual(rows.map((row) => [row.label, row.startTime]), [
    ["a.md", localHHMM("2026-08-17T01:02:00Z")],
    ["b.md", "--:--"]
  ]);
});

test("lint가 진행 중이면 Wiki Lint 행을 뒤에 붙인다", () => {
  const rows = buildWikiWorkRows(
    [makeDocument({ id: "a", filename: "a.md", status: "processing" })],
    makeLog({ created_at: "2026-08-17T03:04:00Z" })
  );
  assert.deepEqual(rows.map((row) => row.label), ["a.md", "Wiki Lint"]);
  assert.equal(rows[1].startTime, localHHMM("2026-08-17T03:04:00Z"));
});

test("진행 중인 작업이 없으면 빈 배열이다", () => {
  assert.deepEqual(buildWikiWorkRows([], null), []);
});
