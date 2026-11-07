import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { agentChatT } from "./agentChatMessages.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    // 앱 소스의 확장자 없는 상대 import(./agentChatTranslator)를 .ts로 푼다.
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

const {
  AGENT_AUTO_APPROVAL_CATEGORIES,
  CLIENT_AUTO_APPROVAL_CATEGORIES,
  DEFAULT_AGENT_AUTO_APPROVAL,
  toggleAgentAutoApproval
} = await import("../src/features/user-settings/lib/agentAutoApproval.ts");
const { fetchAgentAutoApproval, saveAgentAutoApproval } = await import("../src/features/user-settings/api/agentAutoApproval.ts");
const { autoApprovedPlanNote: autoApprovedPlanNoteWith, canApproveAgentPlan, isAutoApprovedPlan } = await import("../src/features/agent-chat/lib/agentPlan.ts");
const autoApprovedPlanNote = (...args) => autoApprovedPlanNoteWith(...args, agentChatT);
const { resolveTaskStatus: resolveTaskStatusWith, withAutoApprovalLabel: withAutoApprovalLabelWith } = await import("../src/features/agent-chat/lib/taskThread.ts");
const resolveTaskStatus = (input) => resolveTaskStatusWith(input, agentChatT);
const withAutoApprovalLabel = (...args) => withAutoApprovalLabelWith(...args, agentChatT);
// 분류 이름·설명·경고 문구는 settings 메시지(ai.autoApproval)에 있다. 한국어 문구를 기준으로 확인한다.
const autoApprovalMessages = JSON.parse(
  readFileSync(new URL("../src/shared/i18n/messages/ko/settings.json", import.meta.url), "utf8")
).ai.autoApproval;
const categoryCopy = (key) => autoApprovalMessages.categories[key];
const AGENT_AUTO_APPROVAL_ALWAYS_MANUAL_NOTE = autoApprovalMessages.alwaysManualNote;

test("자동 승인은 기본으로 모두 꺼져 있다", () => {
  assert.deepEqual(DEFAULT_AGENT_AUTO_APPROVAL, { content_edit: false, organize: false });
  assert.deepEqual(AGENT_AUTO_APPROVAL_CATEGORIES, ["organize", "content_edit"]);
});

for (const [key, expected] of [
  ["organize", { content_edit: false, organize: true }],
  ["content_edit", { content_edit: true, organize: false }]
]) {
  test(`${key}는 켤 때만 경고를 거치고 끌 때는 바로 끈다`, () => {
    const unconfirmed = toggleAgentAutoApproval(DEFAULT_AGENT_AUTO_APPROVAL, key);
    assert.equal(unconfirmed.needsConfirmation, true);
    assert.deepEqual(unconfirmed.next, DEFAULT_AGENT_AUTO_APPROVAL);

    const confirmed = toggleAgentAutoApproval(DEFAULT_AGENT_AUTO_APPROVAL, key, true);
    assert.deepEqual(confirmed, { next: expected, needsConfirmation: false });
    // 끄는 것은 확인 없이 바로 한다.
    assert.deepEqual(toggleAgentAutoApproval(confirmed.next, key), { next: DEFAULT_AGENT_AUTO_APPROVAL, needsConfirmation: false });
    // 원래 설정은 바꾸지 않는다.
    assert.equal(DEFAULT_AGENT_AUTO_APPROVAL[key], false);
  });
}

test("모든 자동 처리 스위치의 경고는 무엇이 바뀌는지와 되돌리는 방법을 적는다", () => {
  const warnings = Object.fromEntries(
    [...AGENT_AUTO_APPROVAL_CATEGORIES, ...CLIENT_AUTO_APPROVAL_CATEGORIES].map((key) => {
      const copy = categoryCopy(key);
      return [key, { title: copy.confirmTitle, description: copy.confirmDescription, confirmLabel: copy.confirmLabel }];
    })
  );
  assert.deepEqual(Object.keys(warnings).sort(), ["autoPublishSkillDrafts", "autoSaveMeetingNotes", "content_edit", "organize"]);
  assert.deepEqual(Object.keys(autoApprovalMessages.categories).sort(), Object.keys(warnings).sort());
  for (const warning of Object.values(warnings)) {
    assert.ok(warning.title && warning.description && warning.confirmLabel);
    assert.match(warning.description, /확인 없이|미리 보기 없이/);
  }
  assert.match(warnings.organize.description, /다시 옮기거나/);
  assert.match(warnings.content_edit.description, /로그 화면/);
  assert.match(warnings.content_edit.description, /그 뒤에 고친 내용/);
  assert.match(warnings.content_edit.description, /휴지통/);
  assert.match(warnings.autoSaveMeetingNotes.description, /휴지통/);
  assert.match(warnings.autoPublishSkillDrafts.description, /스킬 화면/);
});

test("앱에 없는 버전 기록 화면을 되돌리는 방법으로 안내하지 않는다", () => {
  const copy = [...AGENT_AUTO_APPROVAL_CATEGORIES, ...CLIENT_AUTO_APPROVAL_CATEGORIES]
    .flatMap((key) => [categoryCopy(key).description, categoryCopy(key).confirmDescription]);
  for (const text of copy) assert.doesNotMatch(text, /버전 기록/);
});

test("항상 직접 확인하는 경우를 실제 동작대로 안내한다", () => {
  for (const pattern of [/AI 검토 경고/, /기본 선택/, /편집할 권한/, /위 분류에 없는 작업/, /문서가 바뀌/, /범위/, /불러오지 못/, /문서 끝에 추가/, /안전 검토/, /이 브라우저/]) {
    assert.match(AGENT_AUTO_APPROVAL_ALWAYS_MANUAL_NOTE, pattern);
  }
  // AI 계획은 삭제를 제안하지 않아(삭제 도구는 작업 취소 보상용) 안내에 적지 않는다.
  assert.doesNotMatch(AGENT_AUTO_APPROVAL_ALWAYS_MANUAL_NOTE, /삭제/);
});

test("설정 조회·저장은 사용자 설정 API를 쓴다", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
    return Response.json(init?.method === "PUT" ? JSON.parse(init.body) : DEFAULT_AGENT_AUTO_APPROVAL);
  });

  assert.deepEqual(await fetchAgentAutoApproval("ws_test"), DEFAULT_AGENT_AUTO_APPROVAL);
  assert.deepEqual(await saveAgentAutoApproval("ws_test", { content_edit: true, organize: false }), { content_edit: true, organize: false });
  assert.deepEqual(calls, [
    { path: "/api/workspaces/ws_test/agent/auto-approval-settings", method: "GET", body: null },
    { path: "/api/workspaces/ws_test/agent/auto-approval-settings", method: "PUT", body: { content_edit: true, organize: false } }
  ]);
});

test("저장 실패는 서버 오류로 알린다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "INVALID_REQUEST", message: "잘못된 요청" } }, { status: 400 }));
  await assert.rejects(() => saveAgentAutoApproval("ws_test", { content_edit: true, organize: true }));
});

const autoRun = (status, operations) => ({
  id: "run-1",
  status,
  error_code: null,
  plan: { id: "plan-1", version: 1, operation_hash: "a".repeat(64), status: status === "awaiting_approval" ? "awaiting_approval" : "approved", approved_by: "auto:user-setting", operations }
});
const op = (tool_name) => ({ id: tool_name, sequence: 1, tool_name, target_id: "doc-1", source_parent_id: null, destination_parent_id: null, arguments: {}, reason: "", status: "succeeded" });

test("자동 승인한 계획만 자동 승인됨으로 본다", () => {
  assert.equal(isAutoApprovedPlan(autoRun("executing", [op("move_document")])), true);
  const manual = autoRun("completed", [op("move_document")]);
  manual.plan.approved_by = "user";
  assert.equal(isAutoApprovedPlan(manual), false);
  assert.equal(isAutoApprovedPlan({ plan: { ...manual.plan, approved_by: undefined } }), false);
  assert.equal(isAutoApprovedPlan(null), false);
});

test("자동 승인한 계획에는 승인 버튼 대신 되돌리는 방법을 안내한다", () => {
  const run = autoRun("executing", [op("apply_document_edit"), op("create_document"), op("move_document")]);
  assert.equal(canApproveAgentPlan(run), false);
  const note = autoApprovedPlanNote(run.plan);
  assert.match(note, /자동 승인/);
  assert.match(note, /로그 화면/);
  assert.match(note, /휴지통/);
  assert.match(note, /다시 정리/);
  assert.doesNotMatch(autoApprovedPlanNote({ operations: [op("rename_folder")] }), /로그 화면|휴지통/);
});

test("작업 목록 상태에 자동 승인됨을 붙인다", () => {
  const done = resolveTaskStatus({ action: "folder_organize", messageStatus: "completed", runStatus: "completed", operationCount: 2 });
  assert.equal(withAutoApprovalLabel(done, true).label, "저장됨(2) · 자동 승인됨");
  assert.equal(withAutoApprovalLabel(done, false), done);
  const running = resolveTaskStatus({ action: "folder_organize", messageStatus: "completed", runStatus: "executing" });
  assert.equal(withAutoApprovalLabel(running, true).label, "실행 중 · 자동 승인됨");
  // 승인 대기(수동 승인으로 남은 계획)에는 붙이지 않는다.
  const awaiting = resolveTaskStatus({ action: "folder_organize", messageStatus: "completed", runStatus: "awaiting_approval" });
  assert.equal(withAutoApprovalLabel(awaiting, true).label, "승인 대기");
});
