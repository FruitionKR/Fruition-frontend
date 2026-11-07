import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";
import { translator } from "./helpers/i18nMessages.mjs";

// 문서·위키·워크스페이스·그래프·로그·알림 영역의 영어 화면에 한국어가 섞이지 않는지 본다.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && context.parentURL?.includes("/src/") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

const { getWikiActionGate } = await import("../src/features/wiki-ingest/model/wikiActionPermission.ts");
const { formatLintProgressLabel } = await import("../src/features/wiki-ingest/model/activeLintOperation.ts");
const { getWikiReflectLabel } = await import("../src/features/wiki-ingest/model/wikiReflectState.ts");
const { GRAPH_INGEST_BLOCK_REASONS, graphIngestBlockReasonKey } = await import("../src/features/wiki-ingest/model/graphDocuments.ts");
const { buildWikiWorkSections } = await import("../src/features/wiki-ingest/model/wikiWorkList.ts");
const { getChatExportSuccessMessage } = await import("../src/features/wiki-export/lib/exportStatus.ts");
const { getTreeWikiReflectBadge } = await import("../src/widgets/document-sidebar/model/treeWikiReflectBadge.ts");
const { describeNotification, toNoticePayload } = await import("../src/features/document-notifications/model/serverNotifications.ts");
const { summarizeFailedDocuments } = await import("../src/features/document-notifications/model/failedDocumentsNotice.ts");
const feed = await import("../src/widgets/notifications-view/lib/notificationFeed.ts");
const { restoreFailureMessage } = await import("../src/entities/operation-log/model/restoreFailure.ts");
const { documentRestoreMessage } = await import("../src/entities/operation-log/model/restoreMessage.ts");
const { formatOperationLogTitle } = await import("../src/entities/operation-log/model/operationType.ts");
const { formatOperationLogDescription, groupOperationLogsByDate } = await import("../src/entities/operation-log/model/operationLogPage.ts");
const { permissionChangedMessage } = await import("../src/entities/document/lib/documentAccess.ts");
const { TREE_SKIP_REASONS, treeSkipReasonKey } = await import("../src/entities/tree/lib/treeSkipReasons.ts");
const { ApiError } = await import("../src/shared/lib/apiErrors.ts");

const HANGUL = /[가-힣]/;
const ko = (namespace) => translator("ko", namespace);
const en = (namespace) => translator("en", namespace);

/** 같은 호출을 번역 함수 없이(기존 한국어)·ko·en으로 부른다. ko는 기존 문구와 같고 en에는 한국어가 없어야 한다. */
function assertLocalized(name, namespace, call) {
  const fallback = call(undefined);
  assert.deepEqual(call(ko(namespace)), fallback, `${name}: ko 메시지가 기존 한국어 문구와 같다`);
  const english = call(en(namespace));
  assert.doesNotMatch(JSON.stringify(english), HANGUL, `${name}: 영어 문구에 한국어가 없다 (${JSON.stringify(english)})`);
  return english;
}

const md = (id, extra = {}) => ({ id, filename: `${id}.md`, mime_type: "text/markdown", document_role: "EDITABLE", status: "completed", ...extra });

test("위키 편입·최신화 권한 사유, 진행 라벨, 반영 배지를 지금 언어로 쓴다", () => {
  for (const kind of ["ingest", "lint"]) assertLocalized(`gate.${kind}`, "wiki", (t) => getWikiActionGate(false, kind, t));
  assert.deepEqual(getWikiActionGate(null, "ingest", en("wiki")), { isBlocked: true, hint: null });

  const log = { created_at: new Date(Date.now() - 3 * 60_000).toISOString() };
  assertLocalized("lintProgress.running", "wiki.lintProgress", (t) => formatLintProgressLabel(log, false, Date.now(), t));
  assertLocalized("lintProgress.pending", "wiki.lintProgress", (t) => formatLintProgressLabel(null, true, Date.now(), t));

  const documents = [
    md("new", { status: "uploaded" }),
    md("changed", { needs_reingest: true, pipeline_run_id: "run_1" }),
    md("failed", { status: "failed", pipeline_run_id: "run_2" })
  ];
  for (const document of documents) {
    assertLocalized(`reflectLabel.${document.id}`, "wiki.reflect.label", (t) => getWikiReflectLabel(document, t));
    assertLocalized(`reflectBadge.${document.id}`, "wiki.reflect", (t) => getTreeWikiReflectBadge(document, documents, t));
  }
});

test("편입 불가 사유와 트리 건너뜀 사유는 모두 메시지 키로 옮길 수 있다", () => {
  for (const [key, reason] of Object.entries(GRAPH_INGEST_BLOCK_REASONS)) {
    if (key === "convertForbidden") {
      assert.equal(graphIngestBlockReasonKey(reason), null, "변환 권한 없음은 documents.access 문구로 옮긴다");
      continue;
    }
    assert.equal(graphIngestBlockReasonKey(reason), key);
    assert.equal(ko("wiki.ingestBlock")(key), reason);
    assert.doesNotMatch(en("wiki.ingestBlock")(key), HANGUL);
  }
  for (const [key, reason] of Object.entries(TREE_SKIP_REASONS)) {
    assert.equal(treeSkipReasonKey(reason), key);
    assert.equal(ko("documents.tree.skipReason")(key), reason);
    assert.doesNotMatch(en("documents.tree.skipReason")(key), HANGUL);
  }
  assert.equal(treeSkipReasonKey("서버 원문"), null);
});

test("진행 중 작업 팝오버·채팅 저장 안내·서버 알림을 지금 언어로 쓴다", () => {
  const sections = assertLocalized("workList", "wiki.workList", (t) => buildWikiWorkSections(
    [md("a", { status: "processing", processing_started_at: "2026-08-17T02:00:00Z" }), md("b", { status: "processing", pipeline_run_id: "convert:b" })],
    { operation_id: "op_lint", created_at: "2026-08-17T02:00:00Z" },
    [{ operation_id: "op_restore", created_at: "2026-08-17T02:00:00Z" }],
    new Map(),
    t
  ));
  assert.deepEqual(sections.map((section) => section.title), ["Add to wiki", "Refresh wiki", "PDF → MD conversion", "Rollback"]);

  for (const [status, canIngest] of [["skipped", false], ["saved", true], ["saved", false]]) {
    assertLocalized(`export.${status}.${canIngest}`, "wiki.export", (t) => getChatExportSuccessMessage(status, canIngest, t));
  }

  const notification = { id: "n1", type: "edit_conflict", payload: {}, read: false, created_at: "2026-08-17T02:00:00Z" };
  assertLocalized("serverNotification", "wiki.notifications.server", (t) => describeNotification(notification, t));
  assert.equal(toNoticePayload(notification).notificationKey, "server", "제목이 언어마다 달라 설정 항목을 명시한다");
});

test("문서 처리 실패 사유는 공용 번역으로 고른다", () => {
  const failed = [{ filename: "a.md", error_message: null, error_code: "UNKNOWN" }];
  assertLocalized("failedDocuments", "shared", (t) => summarizeFailedDocuments(failed, t));
});

test("알림 화면의 작업·멤버 알림과 시간을 지금 언어로 쓴다", () => {
  const logs = ["succeeded", "partially_succeeded", "failed", "conflict"].map((status, index) => ({
    operation_id: `op_${index}`,
    operation_type: ["ingest", "lint", "restore", "document_edit"][index],
    status,
    created_at: "2026-08-17T02:00:00Z",
    completed_at: "2026-08-17T02:01:00Z",
    target_display_name: "notes.md",
    summary: "summary",
    changed_resource_count: 2
  }));
  assertLocalized("taskNotifications", "workspace.notificationsView", (t) => feed.buildTaskNotifications(logs, t));
  const members = [
    { user_id: "u1", email: "a@example.com", display_name: "Alice", role: "OWNER", joined_at: "2026-08-17T02:00:00Z" },
    { user_id: "u2", email: "b@example.com", display_name: null, role: "MEMBER", joined_at: "2026-08-17T02:00:00Z" }
  ];
  assertLocalized("workspaceNotifications", "workspace.notificationsView", (t) => feed.buildWorkspaceNotifications(members, "me", t));

  const now = Date.parse("2026-08-17T12:00:00Z");
  for (const elapsed of [10_000, 5 * 60_000, 3 * 3600_000, 2 * 86_400_000]) {
    assertLocalized(`time.${elapsed}`, "workspace.notificationsView", (t) => feed.formatNotificationTime(now - elapsed, now, t, t ? "en" : undefined));
  }
  assert.doesNotMatch(feed.formatNotificationTime(now - 30 * 86_400_000, now, en("workspace.notificationsView"), "en"), HANGUL);
});

test("로그 제목·설명·날짜 그룹·롤백 안내를 지금 언어로 쓴다", () => {
  for (const type of ["document_edit", "ingest", "lint", "restore", "wiki_edit"]) {
    assertLocalized(`logTitle.${type}`, "workspace.logs.types", (t) => formatOperationLogTitle({ operation_type: type }, t));
  }
  assert.doesNotMatch(formatOperationLogDescription({ summary: null }, undefined, en("workspace.logMessages")("noDetail")), HANGUL);
  const [group] = groupOperationLogsByDate([{ operation_id: "a", created_at: "2026-09-23T03:00:00Z" }], "Asia/Seoul", "en");
  assert.equal(group.label, "September 23");
  assert.equal(groupOperationLogsByDate([{ operation_id: "a", created_at: "2026-09-23T03:00:00Z" }], "Asia/Seoul")[0].label, "9월 23일");

  for (const location of ["purged", "trash", "unknown"]) {
    assertLocalized(`restoreFailure.${location}`, "workspace.logMessages", (t) => restoreFailureMessage(new ApiError("not found", 404, "DOCUMENT_NOT_FOUND"), location, t));
  }
  assertLocalized("restoreFailure.fallback", "workspace.logMessages", (t) => restoreFailureMessage({}, null, t));
  const preview = { document_id: "d1", from_version: 5, to_version: 2 };
  assertLocalized("documentRestore.laterEdits", "workspace.logMessages", (t) => documentRestoreMessage("notes.md", preview, [], t));
  assertLocalized("documentRestore", "workspace.logMessages", (t) => documentRestoreMessage("notes.md", { ...preview, from_version: 3 }, [], t));
});

test("권한 변경 알림 본문을 지금 언어로 쓴다", () => {
  for (const access of ["view", "edit", null]) {
    assertLocalized(`permissionChanged.${access}`, "documents.permission", (t) => permissionChangedMessage("Notes", access, t));
  }
});

/** 이 PR이 맡은 영역. 알림 발행·API 기본 문구 검사 범위다. */
const SCOPE = /\/(widgets\/(document-sidebar|graph|workspace|log-view|notifications-view|source-preview)|features\/(wiki-ingest|wiki-page-editing|wiki-export|document-notifications|note-editing|document-upload|document-search)|entities\/(operation-log|document|tree))\//;

function scopeSources() {
  const root = new URL("../src/", import.meta.url);
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`)
    .filter((path) => SCOPE.test(path))
    .map((path) => {
      const source = readFileSync(path, "utf8");
      return { path, ast: ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS) };
    });
}

function visitCalls(ast, name, onCall) {
  (function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === name) onCall(node);
    ts.forEachChild(node, visit);
  })(ast);
}

test("맡은 영역의 알림 발행은 모두 notificationKey를 갖는다", () => {
  let checked = 0;
  for (const { path, ast } of scopeSources()) {
    visitCalls(ast, "publishNotice", (node) => {
      const [payload] = node.arguments;
      // 객체 리터럴이 아니면(toNoticePayload·bulkNotice 등) 만드는 함수가 키를 넣는다.
      if (!payload || !ts.isObjectLiteralExpression(payload)) return;
      const hasKey = payload.properties.some((property) =>
        (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && property.name.getText(ast) === "notificationKey");
      assert.ok(hasKey, `${path}: ${payload.getText(ast).slice(0, 80)}에 notificationKey가 없다`);
      checked += 1;
    });
  }
  assert.ok(checked > 30, `검사한 알림 ${checked}건`);
});

test("맡은 영역의 API 기본 문구는 공용 메시지와 같은 한국어이고 영어 문구가 있다", () => {
  const koShared = ko("shared");
  const enShared = en("shared");
  let checked = 0;
  for (const { path, ast } of scopeSources()) {
    visitCalls(ast, "sharedText", (node) => {
      const [key, korean] = node.arguments;
      assert.ok(ts.isStringLiteral(key), `${path}: sharedText 키는 문자열 리터럴이어야 한다`);
      const values = {};
      const text = ts.isStringLiteral(korean)
        ? korean.text
        : korean.getText(ast).slice(1, -1).replace(/\$\{([^}]*)\}/g, (_, expression) => {
          const name = expression.split(".").at(-1).replace(/\W/g, "");
          values[name] = `<${name}>`;
          return `<${name}>`;
        });
      // 템플릿 자리값 이름을 메시지 자리표시자 이름과 맞춘다(holder→name).
      const koValues = Object.fromEntries(Object.entries(values).map(([name, value]) => [name === "holder" ? "name" : name, value]));
      assert.equal(koShared(key.text, koValues), text, `${path}: ${key.text}`);
      assert.doesNotMatch(enShared(key.text, koValues), HANGUL, `${path}: ${key.text} 영어 문구`);
      checked += 1;
    });
  }
  assert.ok(checked > 25, `검사한 문구 ${checked}건`);
});
