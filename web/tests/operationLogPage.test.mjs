import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  formatOperationLogTitle,
  OPERATION_TYPE_LABELS
} from "../src/entities/operation-log/model/operationType.ts";
import { formatElapsedMinutes } from "../src/features/wiki-ingest/model/activeLintOperation.ts";

// 확장자 없는 상대 import(작업 요약 번역 모듈)를 .ts 소스로 해석한다.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && context.parentURL?.includes("/src/") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

const {
  appendLogPage,
  collectRestoredOperationIds,
  filterOperationLogsByType,
  filterVisibleOperationLogs,
  formatOperationLogDateTime,
  formatOperationLogDescription,
  groupOperationLogsByDate,
  mergeRefreshedLogPage,
  OPERATION_LOG_TYPE_TABS,
  pickSelectedOperationId
} = await import("../src/entities/operation-log/model/operationLogPage.ts");
const { translator } = await import("./helpers/i18nMessages.mjs");

function log(operationId, operationType = "document_edit") {
  return { operation_id: operationId, operation_type: operationType };
}

test("다음 페이지를 최신순 뒤에 이어붙인다", () => {
  const merged = appendLogPage([log("op1"), log("op2")], [log("op3"), log("op4")]);
  assert.deepEqual(merged.map((item) => item.operation_id), ["op1", "op2", "op3", "op4"]);
});

test("커서 경계에서 겹친 operation_id는 다시 붙이지 않는다", () => {
  const merged = appendLogPage([log("op1"), log("op2")], [log("op2"), log("op3")]);
  assert.deepEqual(merged.map((item) => item.operation_id), ["op1", "op2", "op3"]);
});

test("새 항목이 없으면 이전 배열을 그대로 돌려준다", () => {
  const previous = [log("op1")];
  assert.equal(appendLogPage(previous, [log("op1")]), previous);
  assert.equal(appendLogPage(previous, []), previous);
});

test("이전 배열을 변형하지 않는다", () => {
  const previous = [log("op1")];
  appendLogPage(previous, [log("op2")]);
  assert.deepEqual(previous.map((item) => item.operation_id), ["op1"]);
});

test("유형이 섞인 목록도 시간순 그대로 이어붙인다", () => {
  const merged = appendLogPage(
    [log("op1", "ingest")],
    [log("op2", "lint"), log("op3", "restore")]
  );
  assert.deepEqual(merged.map((item) => item.operation_type), ["ingest", "lint", "restore"]);
});

test("첫 페이지 갱신은 최신 항목을 교체하고 이미 불러온 이전 페이지를 보존한다", () => {
  const merged = mergeRefreshedLogPage(
    [{ ...log("op1"), summary: "이전" }, log("op2"), log("op3")],
    [log("op0"), { ...log("op1"), summary: "갱신" }]
  );

  assert.deepEqual(merged.map((item) => item.operation_id), ["op0", "op1", "op2", "op3"]);
  assert.equal(merged[1].summary, "갱신");
});

test("선택이 없으면 첫 작업을 자동으로 고르지 않는다", () => {
  assert.equal(pickSelectedOperationId([log("op1"), log("op2")], null), null);
});

test("이미 고른 작업이 목록에 있으면 유지한다", () => {
  assert.equal(pickSelectedOperationId([log("op1"), log("op2")], "op2"), "op2");
});

test("고른 작업이 목록에서 사라지면 선택을 해제한다", () => {
  assert.equal(pickSelectedOperationId([log("op1"), log("op2")], "gone"), null);
});

test("목록이 비면 선택이 없다", () => {
  assert.equal(pickSelectedOperationId([], "op1"), null);
  assert.equal(pickSelectedOperationId([], null), null);
});

test("restore 로그에서 이미 롤백한 원본 작업 ID를 수집한다", () => {
  const restoredIds = collectRestoredOperationIds([
    { ...log("restore-1", "restore"), restored_from: "op-1" },
    { ...log("op-2"), restored_from: null }
  ]);

  assert.deepEqual([...restoredIds], ["op-1"]);
});

test("작업 유형 라벨은 Figma 로그 화면의 한국어 명칭을 쓴다", () => {
  assert.deepEqual(OPERATION_TYPE_LABELS, {
    document_edit: "AI 편집 반영",
    ingest: "위키 편입",
    lint: "위키 최신화",
    restore: "롤백",
    wiki_edit: "위키 직접 편집"
  });
});

test("로그를 한국 날짜 기준으로 최신순 그룹에 담는다", () => {
  const groups = groupOperationLogsByDate([
    { ...log("op1"), created_at: "2026-08-02T15:30:00Z" },
    { ...log("op2"), created_at: "2026-08-02T14:59:00Z" },
    { ...log("op3"), created_at: "2026-08-02T12:00:00Z" }
  ], "Asia/Seoul");

  assert.deepEqual(groups.map((group) => ({
    key: group.dateKey,
    label: group.label,
    ids: group.items.map((item) => item.operation_id)
  })), [
    { key: "2026-8-3", label: "8월 3일", ids: ["op1"] },
    { key: "2026-8-2", label: "8월 2일", ids: ["op2", "op3"] }
  ]);
});

test("문서명과 작업 요약을 Figma 보조 문구로 조합한다", () => {
  assert.equal(
    formatOperationLogDescription({ summary: "concept page" }, "학습지원 사례집"),
    "학습지원 사례집 / concept page"
  );
  assert.equal(formatOperationLogDescription({ summary: "문서 편집" }), "문서 편집");
  assert.equal(formatOperationLogDescription({ summary: null }), "상세 정보 없음");
});

test("Ingest 로그 제목은 시작 시점의 문서 이름을 쓴다", () => {
  assert.equal(
    formatOperationLogTitle({ operation_type: "ingest", target_display_name: "회의록" }),
    "회의록"
  );
  assert.equal(formatOperationLogTitle(log("op-lint", "lint")), "위키 최신화");
});

test("실제 바꾼 문서 없이 성공으로 끝난 lint 로그만 숨긴다", () => {
  const lintLog = (operationId, status, changedResourceCount) => ({
    ...log(operationId, "lint"),
    status,
    changed_resource_count: changedResourceCount
  });
  const visible = filterVisibleOperationLogs([
    lintLog("lint-noop", "succeeded", 0),
    lintLog("lint-changed", "succeeded", 3),
    lintLog("lint-processing", "processing", 0),
    lintLog("lint-failed", "failed", 0),
    { ...log("edit-1"), status: "succeeded", changed_resource_count: 0 }
  ]);

  assert.deepEqual(
    visible.map((item) => item.operation_id),
    ["lint-changed", "lint-processing", "lint-failed", "edit-1"]
  );
});

test("실행 시작 시각으로 경과 분을 표시한다", () => {
  assert.equal(
    formatElapsedMinutes("2026-08-19T00:00:00Z", Date.parse("2026-08-19T00:00:59Z")),
    "0분째 실행 중"
  );
  assert.equal(
    formatElapsedMinutes("2026-08-19T00:00:00Z", Date.parse("2026-08-19T00:05:30Z")),
    "5분째 실행 중"
  );
});

test("로그 화면 탭은 작업 유형으로 거르고, 유형이 없으면 전체를 그대로 돌려준다", () => {
  const items = [log("op1", "ingest"), log("op2", "document_edit"), log("op3", "ingest")];

  assert.deepEqual(
    filterOperationLogsByType(items, "ingest").map((item) => item.operation_id),
    ["op1", "op3"]
  );
  assert.deepEqual(filterOperationLogsByType(items, "restore"), []);
  assert.equal(filterOperationLogsByType(items, null), items);
});

test("로그 화면 유형 탭에 위키 직접 편집(wiki_edit)은 없다", () => {
  assert.deepEqual(OPERATION_LOG_TYPE_TABS, [null, "document_edit", "ingest", "lint", "restore"]);
  assert.ok(!OPERATION_LOG_TYPE_TABS.includes("wiki_edit"));
});

test("과거 wiki_edit 로그는 전체 탭에 남고 제목·설명이 지금 언어로 보인다", () => {
  const past = { ...log("op-wiki", "wiki_edit"), status: "succeeded", changed_resource_count: 1, summary: "Wiki 페이지 본문을 직접 수정했습니다." };
  const items = [log("op1", "ingest"), past];

  assert.deepEqual(filterOperationLogsByType(items, null).map((item) => item.operation_id), ["op1", "op-wiki"]);
  assert.equal(formatOperationLogTitle(past), "위키 직접 편집");
  assert.equal(formatOperationLogTitle(past, translator("ko", "workspace.logs.types")), "위키 직접 편집");
  assert.equal(formatOperationLogTitle(past, translator("en", "workspace.logs.types")), "Wiki edits");
  assert.equal(
    formatOperationLogDescription(past, undefined, "No details", translator("en", "workspace.logMessages.summary")),
    "Edited the wiki page content directly."
  );
  assert.equal(formatOperationLogDescription(past), "Wiki 페이지 본문을 직접 수정했습니다.");
});

test("로그 행 시각은 사용자 시간대의 월·일·시각으로 표시한다", () => {
  assert.equal(formatOperationLogDateTime("2026-08-02T15:30:00Z", "Asia/Seoul"), "8월 3일 오전 12:30");
  assert.equal(formatOperationLogDateTime("2026-09-23T00:52:00Z", "Asia/Seoul"), "9월 23일 오전 9:52");
});
