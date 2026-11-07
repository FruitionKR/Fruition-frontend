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
});

// document OperationRecorder·OperationFailureSummary·RestoreOperationLifecycle·RestoreRebuildApplier·AiTaskResultApplier(lint)·
// WikiPageEditService·RestorePreviewStaleException, ai ingest_worker가 저장하는 작업 요약.
const SERVER_SUMMARIES = [
  [{ operation_type: "ingest", status: "succeeded" }, "Wiki ingest를 완료했습니다.", "Wiki ingest completed."],
  [{ operation_type: "ingest", status: "partially_succeeded" }, "Wiki ingest를 일부만 반영했습니다.", "Wiki ingest was only partially applied."],
  [{ operation_type: "ingest", status: "failed" }, "Wiki ingest에 실패했습니다.", "Wiki ingest failed."],
  [{ operation_type: "lint", status: "succeeded" }, "Wiki lint로 페이지 3개를 변경했습니다.", "Wiki lint changed 3 pages."],
  [{ operation_type: "lint", status: "succeeded" }, "Wiki lint로 페이지 1개를 변경했습니다.", "Wiki lint changed 1 page."],
  [{ operation_type: "lint", status: "partially_succeeded" }, "Wiki 정합성 검사를 일부만 반영했습니다.", "The wiki consistency check was only partially applied."],
  [{ operation_type: "lint", status: "failed" }, "Wiki 정합성 검사에 실패했습니다.", "The wiki consistency check failed."],
  [{ operation_type: "restore", status: "succeeded" }, "버전 1 내용으로 되돌렸습니다. 새 버전 4", "Rolled back to the content of version 1. New version 4"],
  [{ operation_type: "restore", status: "succeeded" }, "페이지 변경 2건 · 삭제 1건 · 링크 제거 0건 · 링크 복원 3건 · 실패 0건", "Pages changed 2 · Deleted 1 · Links removed 0 · Links restored 3 · Failed 0"],
  [{ operation_type: "restore", status: "partially_succeeded" }, "되돌리기를 일부만 반영했습니다.", "The rollback was only partially applied."],
  [{ operation_type: "restore", status: "failed" }, "되돌리기에 실패했습니다.", "The rollback failed."],
  [{ operation_type: "restore", status: "failed" }, "뒤에 실행한 작업과 충돌해 되돌리지 않았습니다. 뒤 작업부터 되돌려 주세요.", "Not rolled back because it conflicts with a later operation. Roll back the later operation first."],
  [{ operation_type: "restore", status: "conflict" }, "복구 대상이 변경되었습니다. 미리보기를 다시 확인해 주세요.", "The rollback target has changed. Check the preview again."],
  [{ operation_type: "document_edit", status: "succeeded", changed_resource_count: 1 }, "AI 편집을 문서에 반영했습니다.", "Applied the AI edit to the document."],
  [{ operation_type: "document_edit", status: "succeeded", changed_resource_count: 0 }, "AI 편집 결과가 현재 본문과 같습니다.", "The AI edit result is the same as the current content."],
  [{ operation_type: "document_edit", status: "partially_succeeded" }, "AI 편집을 일부만 반영했습니다.", "The AI edit was only partially applied."],
  [{ operation_type: "document_edit", status: "failed" }, "AI 편집을 반영하지 못했습니다.", "Couldn't apply the AI edit."],
  [{ operation_type: "document_edit", status: "conflict" }, "문서가 이미 변경되어 AI 편집을 반영하지 못했습니다.", "Couldn't apply the AI edit because the document had already changed."],
  [{ operation_type: "wiki_edit", status: "succeeded" }, "Wiki 페이지 본문을 직접 수정했습니다.", "Edited the wiki page content directly."],
  [{ operation_type: "wiki_edit", status: "failed" }, "Wiki 본문 수정을 반영하지 못했습니다.", "Couldn't apply the wiki content edit."]
];

test("서버가 한국어로 저장한 알려진 작업 요약은 영어 로그 설명에서 영어로 보이고, ko에서는 서버 문구와 같다", () => {
  for (const [fields, server, english] of SERVER_SUMMARIES) {
    const item = { changed_resource_count: 1, ...fields, summary: server };
    assert.equal(formatOperationLogDescription(item, undefined, "No details", en("workspace.logMessages.summary")), english, server);
    assert.equal(formatOperationLogDescription(item, undefined, "상세 정보 없음", ko("workspace.logMessages.summary")), server, server);
    assert.equal(formatOperationLogDescription(item), server, `${server}: 번역 함수가 없으면 서버 문구`);
  }
  // 문서 이름은 그대로 앞에 붙는다.
  assert.equal(
    formatOperationLogDescription({ operation_type: "document_edit", status: "succeeded", changed_resource_count: 1, summary: "AI 편집을 문서에 반영했습니다." }, "회의록", "No details", en("workspace.logMessages.summary")),
    "회의록 / Applied the AI edit to the document."
  );
});

test("알 수 없는 종류·문구이거나 숫자를 읽을 수 없는 요약은 서버 문구를 그대로 둔다", () => {
  const tSummary = en("workspace.logMessages.summary");
  const keep = [
    { operation_type: "future_type", status: "succeeded", summary: "새 작업을 마쳤습니다." },
    { operation_type: "restore", status: "failed", summary: "다른 이유로 되돌리지 못했습니다." },
    { operation_type: "restore", status: "succeeded", summary: "새 형식의 복구 요약" },
    { operation_type: "lint", status: "succeeded", summary: "Wiki lint를 마쳤습니다." },
    { operation_type: "ingest", status: "processing", summary: "처리 중" }
  ];
  for (const item of keep) {
    assert.equal(formatOperationLogDescription({ changed_resource_count: 0, ...item }, undefined, "No details", tSummary), item.summary);
  }
  // 요약이 없는 진행 중 작업에 문구를 지어내지 않는다.
  assert.equal(formatOperationLogDescription({ operation_type: "ingest", status: "processing", changed_resource_count: 0, summary: null }, undefined, "No details", tSummary), "No details");
});

test("lint의 서버 작업 이름(위키 다듬기)은 영어 설명·알림에 문서 이름처럼 붙지 않는다", () => {
  const lint = { operation_id: "op_l", operation_type: "lint", status: "succeeded", changed_resource_count: 3, target_document_id: null,
    target_display_name: "위키 다듬기", summary: "Wiki lint로 페이지 3개를 변경했습니다.", restored_from: null,
    created_at: "2026-09-23T03:00:00Z", completed_at: "2026-09-23T03:01:00Z" };
  const tSummary = en("workspace.logMessages.summary");
  assert.equal(formatOperationLogDescription(lint, lint.target_display_name, "No details", tSummary), "Wiki lint changed 3 pages.");
  const [item] = feed.buildTaskNotifications([lint], en("workspace.notificationsView"), tSummary);
  assert.doesNotMatch(item.description, HANGUL);
  for (const line of item.details) assert.doesNotMatch(line, HANGUL);
  // 번역 함수를 넘기지 않는 기존 호출은 그대로다.
  assert.match(feed.buildTaskNotifications([lint])[0].description, /위키 다듬기/);
});

test("로그 날짜 그룹(한국어)과 롤백 안내를 지금 언어로 쓴다", () => {
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
