import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { NOTIFICATION_SETTINGS, DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_NOTIFICATION_CONTROLS, normalizeNotificationPreferences, normalizeUserPreferences } = await import("../src/entities/user/model/preferences.ts");
const { noticeNotificationKey, isNoticeEnabled } = await import("../src/features/document-notifications/model/noticePreference.ts");
const notice = (title, extra = {}) => ({ kind: "completed", title, message: "test", ...extra });

test("모든 등록된 알림 종류는 독립적으로 켜고 끌 수 있다", () => {
  const seen = new Set();
  for (const [key, setting] of Object.entries(NOTIFICATION_SETTINGS)) {
    for (const title of setting.titles) {
      assert.equal(seen.has(title), false, `중복 제목: ${title}`);
      seen.add(title);
      assert.equal(noticeNotificationKey(notice(title)), key);
      const enabled = { ...DEFAULT_NOTIFICATION_PREFERENCES, [key]: true };
      assert.equal(isNoticeEnabled(notice(title), enabled), true);
      assert.equal(isNoticeEnabled(notice(title), { ...enabled, [key]: false }), false);
    }
  }
});

test("휴지통 복구·AI 롤백·완료·실패는 서로 영향을 주지 않는다", () => {
  const settings = { ...DEFAULT_NOTIFICATION_PREFERENCES, restore: false, lint: false, completed: false, query: false, queryFailed: true };
  assert.equal(isNoticeEnabled(notice("문서 복구 완료"), settings), true);
  assert.equal(isNoticeEnabled(notice("롤백 요청 완료"), settings), false);
  assert.equal(isNoticeEnabled(notice("위키 최신화 실패", { kind: "failed", operation: { type: "lint" } }), settings), true);
  assert.equal(isNoticeEnabled(notice("질의 실패", { kind: "failed" }), settings), true);
  assert.equal(isNoticeEnabled(notice("PDF 변환 완료"), settings), true);
});

test("동적인 작업 로그와 알 수 없는 알림도 설정을 우회하지 않는다", () => {
  assert.equal(noticeNotificationKey(notice("동적 제목", { operation: { type: "restore" } })), "restore");
  assert.equal(noticeNotificationKey(notice("동적 실패", { kind: "failed", operation: { type: "restore" } })), "restoreFailed");
  assert.equal(noticeNotificationKey(notice("새로운 안내")), "other");
  assert.equal(isNoticeEnabled(notice("새로운 안내"), { ...DEFAULT_NOTIFICATION_PREFERENCES, other: false }), false);
});

test("전체 알림을 끄면 모든 종류를 막고 그룹을 끄면 해당 종류만 막는다", () => {
  const allOn = Object.fromEntries(Object.keys(NOTIFICATION_SETTINGS).map((key) => [key, true]));
  const globalOff = { ...DEFAULT_NOTIFICATION_CONTROLS, enabled: false };
  for (const setting of Object.values(NOTIFICATION_SETTINGS)) {
    for (const title of setting.titles) assert.equal(isNoticeEnabled(notice(title), allOn, globalOff), false);
  }
  const groupOff = { ...DEFAULT_NOTIFICATION_CONTROLS, groups: { ...DEFAULT_NOTIFICATION_CONTROLS.groups, "문서·PDF": false } };
  assert.equal(isNoticeEnabled(notice("문서 복구 완료"), allOn, groupOff), false);
  assert.equal(isNoticeEnabled(notice("질의 완료"), allOn, groupOff), true);
  assert.equal(allOn.trashRestore, true, "개별 선택은 그대로 보존한다");
});

test("상위 알림 스위치의 저장·복원과 구버전 기본값을 보장한다", () => {
  assert.deepEqual(normalizeUserPreferences({}).notificationControls, DEFAULT_NOTIFICATION_CONTROLS);
  const restored = normalizeUserPreferences({ notificationControls: { enabled: false, groups: { "문서·PDF": false } }, notifications: { trashRestore: true } });
  assert.equal(restored.notificationControls.enabled, false);
  assert.equal(restored.notificationControls.groups["문서·PDF"], false);
  assert.equal(restored.notificationControls.groups["위키"], true);
  assert.equal(restored.notifications.trashRestore, true);
});

test("구버전 설정을 분리한 종류에 이어받고 명시적으로 바꾼 값은 우선한다", () => {
  const settings = normalizeNotificationPreferences({ completed: false, query: true, suggest: false, lint: false, restore: false });
  assert.equal(settings.pdfCompleted, false);
  assert.equal(settings.queryFailed, true);
  for (const key of ["newDocument", "ingestStalled", "ingestChanged", "lintSuggest", "lintFailed", "restoreFailed"]) assert.equal(settings[key], false);
  assert.equal(settings.trashRestore, true, "예전에 항상 표시하던 알림은 켜진 상태를 유지한다");
  assert.equal(normalizeNotificationPreferences({ query: false, queryFailed: true }).queryFailed, true);
  assert.deepEqual(normalizeNotificationPreferences(null), DEFAULT_NOTIFICATION_PREFERENCES);
});

test("실제 발행 코드의 고정 제목은 빠짐없이 설정 목록에 등록한다", () => {
  const root = new URL("../src/", import.meta.url);
  let checked = 0;
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const path = `${entry.parentPath}/${entry.name}`;
    const source = readFileSync(path, "utf8");
    if (!source.includes("publishNotice(")) continue;
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === "publishNotice" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        const title = node.arguments[0].properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(ast) === "title");
        if (title && ts.isStringLiteral(title.initializer)) {
          assert.notEqual(noticeNotificationKey(notice(title.initializer.text)), "other", `${path}: ${title.initializer.text}`);
          checked += 1;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  assert.ok(checked > 30);
  for (const title of ["폴더 생성 실패", "문서 묶음 생성 실패", "항목 이동 실패", "삭제 실패", "이름 변경 실패", "이동 완료", "일부 이동 실패", "삭제 완료", "일부 삭제 실패", "지금 내용으로 저장했어요", "Wiki 최신 상태"]) {
    assert.notEqual(noticeNotificationKey(notice(title)), "other", title);
  }
});
