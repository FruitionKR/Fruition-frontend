import assert from "node:assert/strict";
import test from "node:test";
import {
  hasFinishedSince,
  latestProcessedAt
} from "../src/features/document-notifications/model/finishedWhilePaused.ts";

const PAUSED_AT = "2026-10-06T12:00:00Z";
const baseline = Date.parse(PAUSED_AT);

function makeDocument(overrides) {
  return {
    status: "completed",
    processing_started_at: "2026-10-06T12:01:00Z",
    processed_at: "2026-10-06T12:02:00Z",
    ...overrides
  };
}

test("기준점은 processed_at 중 가장 늦은 시각이고, 없으면 null이다", () => {
  assert.equal(latestProcessedAt([
    { processed_at: "2026-10-06T11:00:00Z" },
    { processed_at: PAUSED_AT },
    { processed_at: undefined },
    { processed_at: "잘못된 값" }
  ]), baseline);
  assert.equal(latestProcessedAt([]), null);
  assert.equal(latestProcessedAt([{ processed_at: undefined }]), null);
});

test("기준점 이후 파이프라인을 마친 문서는 완료·실패 모두 전이로 본다", () => {
  assert.equal(hasFinishedSince(makeDocument({}), baseline), true);
  assert.equal(hasFinishedSince(makeDocument({ status: "failed" }), baseline), true);
});

test("기준점과 같거나 이전에 끝난 문서는 전이가 아니다", () => {
  assert.equal(hasFinishedSince(makeDocument({ processed_at: PAUSED_AT }), baseline), false);
  assert.equal(hasFinishedSince(makeDocument({ processed_at: "2026-10-06T11:59:59Z" }), baseline), false);
});

test("아직 처리 중이거나 파이프라인을 거치지 않은 문서는 제외한다", () => {
  assert.equal(hasFinishedSince(makeDocument({ status: "processing" }), baseline), false);
  // 직접 생성한 Markdown·복제본: processing_started_at 없이 completed
  assert.equal(hasFinishedSince(makeDocument({ processing_started_at: undefined }), baseline), false);
  assert.equal(hasFinishedSince(makeDocument({ processed_at: undefined }), baseline), false);
  assert.equal(hasFinishedSince(makeDocument({ processed_at: "잘못된 값" }), baseline), false);
});
