import assert from "node:assert/strict";
import test from "node:test";
import { groupVersionsByInterval, VERSION_GROUP_INTERVAL_MS } from "../src/features/document-history/lib/versionGroups.ts";

const at = (minute, second = 0) => new Date(Date.UTC(2026, 9, 7, 9, minute, second)).toISOString();
const version = (number, createdAt) => ({ version: number, created_at: createdAt });

test("10분 버킷마다 마지막 버전만 남기고 최신 순서를 유지한다", () => {
  const versions = [
    version(6, at(25)),
    version(5, at(21)),
    version(4, at(19, 59)),
    version(3, at(12)),
    version(2, at(3)),
    version(1, at(0))
  ];
  const grouped = groupVersionsByInterval(versions, VERSION_GROUP_INTERVAL_MS, null);
  assert.deepEqual(grouped.map((item) => item.version), [6, 4, 2]);
});

test("현재 버전은 같은 버킷에 더 최신 버전이 있어도 항상 남긴다", () => {
  const versions = [version(3, at(5)), version(2, at(4)), version(1, at(3))];
  assert.deepEqual(groupVersionsByInterval(versions, VERSION_GROUP_INTERVAL_MS, 2).map((item) => item.version), [3, 2]);
  assert.deepEqual(groupVersionsByInterval(versions, VERSION_GROUP_INTERVAL_MS, 3).map((item) => item.version), [3]);
});

test("시각을 읽을 수 없는 버전은 묶지 않는다", () => {
  const versions = [version(3, "invalid"), version(2, at(1)), version(1, "")];
  assert.deepEqual(groupVersionsByInterval(versions, VERSION_GROUP_INTERVAL_MS, null).map((item) => item.version), [3, 2, 1]);
});

test("입력이 오래된 순이어도 버킷의 가장 높은 버전을 남긴다", () => {
  const versions = [version(1, at(0)), version(2, at(1)), version(3, at(11))];
  assert.deepEqual(groupVersionsByInterval(versions, VERSION_GROUP_INTERVAL_MS, null).map((item) => item.version), [2, 3]);
});

test("빈 목록은 빈 목록을 돌려준다", () => {
  assert.deepEqual(groupVersionsByInterval([], VERSION_GROUP_INTERVAL_MS, 1), []);
});
