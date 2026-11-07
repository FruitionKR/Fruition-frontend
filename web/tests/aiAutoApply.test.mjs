import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { useTranslations } from "./fakeNextIntl.mjs";

// 화면과 같이 agentChat 메시지를 한국어로 풀어 문구까지 확인한다.
const agentChatT = useTranslations("agentChat");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  }
});

const {
  appliedTaskNote: appliedTaskNoteWith,
  autoAppliedTaskNote: autoAppliedTaskNoteWith,
  isContentEditAutoApproved,
  resolveTurnAutoApply
} = await import("../src/features/agent-chat/lib/autoApply.ts");
const appliedTaskNote = (...args) => appliedTaskNoteWith(...args, agentChatT);
const autoAppliedTaskNote = (...args) => autoAppliedTaskNoteWith(...args, agentChatT);
const { shouldAutoSaveMeetingNotes } = await import("../src/features/meeting-dictation/lib/meetingNotesFlow.ts");
const { shouldAutoPublishSkillDraft } = await import("../src/features/skill-authoring/lib/skillAuthoring.ts");
const { parseTaskOutcomes, recordTaskOutcome, turnIdsWithOutcome } = await import("../src/features/agent-chat/lib/taskOutcomes.ts");

const editInput = (overrides = {}) => ({
  action: "markdown_edit",
  isContentEditAutoApproved: true,
  isAlreadyHandled: false,
  isManualOnly: false,
  isFromActiveSession: true,
  hasEditPreview: true,
  hasApplyOperationId: true,
  validationError: null,
  isDocumentWritable: true,
  proposalCount: 1,
  isScopeExpanded: false,
  isDraftFolderWriteDenied: false,
  draft: null,
  ...overrides
});
const createInput = (overrides = {}) => editInput({
  action: "markdown_create",
  hasEditPreview: false,
  proposalCount: 0,
  isDocumentWritable: false,
  draft: { title: "새 문서", summary: "요약", markdown: "# 본문" },
  ...overrides
});

test("설정을 다 받았고 켜져 있을 때만 자동 승인으로 본다", () => {
  assert.equal(isContentEditAutoApproved({ data: { content_edit: true }, isError: false, isFetching: false }), true);
  assert.equal(isContentEditAutoApproved({ data: { content_edit: false }, isError: false, isFetching: false }), false);
  // 조회 중·실패는 지난 값이 남아 있어도 수동이다.
  assert.equal(isContentEditAutoApproved({ data: undefined, isError: false, isFetching: true }), false);
  assert.equal(isContentEditAutoApproved({ data: { content_edit: true }, isError: false, isFetching: true }), false);
  assert.equal(isContentEditAutoApproved({ data: { content_edit: true }, isError: true, isFetching: false }), false);
  assert.equal(isContentEditAutoApproved({ data: undefined, isError: true, isFetching: false }), false);
});

test("켜져 있고 적용할 수 있는 편집안은 바로 적용한다", () => {
  assert.equal(resolveTurnAutoApply(editInput()), "edit");
});

test("적용할 수 없는 편집안은 수락 화면으로 둔다", () => {
  const manual = [
    { isContentEditAutoApproved: false },
    { hasEditPreview: false },
    // 적용 표가 없으면 로그 화면에서 롤백할 수 없다.
    { hasApplyOperationId: false },
    { validationError: "요청 이후 문서가 변경되었습니다." },
    { isDocumentWritable: false },
    { proposalCount: 0 },
    { isScopeExpanded: true },
    { isManualOnly: true },
    { isFromActiveSession: false }
  ];
  for (const overrides of manual) assert.equal(resolveTurnAutoApply(editInput(overrides)), null, JSON.stringify(overrides));
});

test("요청 뒤 다른 대화로 옮겼으면 초안을 만들지 않는다", () => {
  assert.equal(resolveTurnAutoApply(createInput({ isFromActiveSession: false })), null);
});

test("같은 응답은 두 번 처리하지 않는다", () => {
  assert.equal(resolveTurnAutoApply(editInput({ isAlreadyHandled: true })), null);
  assert.equal(resolveTurnAutoApply(createInput({ isAlreadyHandled: true })), null);
});

test("켜져 있으면 새 문서 초안을 바로 만든다", () => {
  assert.equal(resolveTurnAutoApply(createInput()), "create");
});

test("만들 수 없는 초안은 기존 화면으로 둔다", () => {
  const manual = [
    { isContentEditAutoApproved: false },
    { draft: null },
    { draft: { title: "제목", summary: "", markdown: "   " } },
    { isManualOnly: true }
  ];
  for (const overrides of manual) assert.equal(resolveTurnAutoApply(createInput(overrides)), null, JSON.stringify(overrides));
});

test("쓸 수 없는 폴더로 온 초안은 서버에 보내지 않고 수동 화면으로 둔다", () => {
  assert.equal(resolveTurnAutoApply(createInput({ isDraftFolderWriteDenied: true })), null);
  // 권한을 모르면 막지 않고 지금처럼 서버가 판단한다(isFolderWriteDenied가 false).
  assert.equal(resolveTurnAutoApply(createInput({ isDraftFolderWriteDenied: false })), "create");
});

test("초안 폴더의 쓰기 권한은 열린 문서에 적용하는 편집안을 막지 않는다", () => {
  assert.equal(resolveTurnAutoApply(editInput({ isDraftFolderWriteDenied: true })), "edit");
});

test("자동 판단은 초안을 만들 폴더의 쓰기 차단을 받아 쓴다", () => {
  const source = readFileSync(new URL("../src/widgets/agent-panel/model/useAgentTurn.ts", import.meta.url), "utf8");
  assert.match(source, /isDraftFolderWriteDenied: draftFolderId !== null && isFolderWriteDenied\(draftFolderId\)/);
  assert.match(source, /const draftFolderId = resolveGeneratedDocumentFolderId\(agentTurnResponse\)/);
  const panel = readFileSync(new URL("../src/widgets/agent-panel/ui/AgentPanel.tsx", import.meta.url), "utf8");
  assert.match(panel.slice(panel.indexOf("useAgentTurn({"), panel.indexOf("const { agentTurnRequest, agentTurnResponse")), /isFolderWriteDenied,/);
});

test("편집·초안이 아닌 응답은 자동 처리하지 않는다", () => {
  for (const action of ["folder_organize", "workspace_workflow", "skill_authoring", "skill_draft_proposal", "clarify", "chat_answer"]) {
    assert.equal(resolveTurnAutoApply(editInput({ action })), null, action);
  }
});

test("자동 처리한 작업에는 되돌리는 방법을 알린다", () => {
  assert.match(autoAppliedTaskNote("markdown_edit"), /자동 승인/);
  assert.match(autoAppliedTaskNote("markdown_edit"), /로그 화면/);
  assert.match(autoAppliedTaskNote("markdown_edit"), /그 뒤에 고친 내용/);
  assert.match(autoAppliedTaskNote("markdown_create"), /휴지통/);
});

test("서버 기록으로만 저장을 확인한 편집은 자동 승인이라 단정하지 않고 되돌리는 방법을 알린다", () => {
  // 새 브라우저: 이 화면의 기록(localStorage)은 없고 문서 버전에 적용 ID가 있다.
  const note = appliedTaskNote({ action: "markdown_edit", isAutoApplied: false, isAppliedHere: false, isServerApplied: true });
  assert.match(note, /로그 화면/);
  assert.match(note, /그 뒤에 고친 내용/);
  assert.doesNotMatch(note, /자동 승인/);
  assert.doesNotMatch(note, /아직/);
});

test("완료 행 안내는 저장 사실을 아는 경우에만 붙인다", () => {
  const base = { action: "markdown_edit", isAutoApplied: false, isAppliedHere: false, isServerApplied: false };
  assert.equal(appliedTaskNote(base), null);
  // 이 화면에서 직접 수락한 편집은 지금처럼 안내하지 않는다. 서버 기록이 뒤따라와도 같다.
  assert.equal(appliedTaskNote({ ...base, isAppliedHere: true, isServerApplied: true }), null);
  assert.equal(appliedTaskNote({ ...base, isAutoApplied: true, isAppliedHere: true }), autoAppliedTaskNote("markdown_edit"));
  assert.equal(appliedTaskNote({ ...base, action: "markdown_create", isAutoApplied: true, isAppliedHere: true }), autoAppliedTaskNote("markdown_create"));
});

test("자동 처리 기록은 새로 고침 뒤에도 적용으로 남는다", () => {
  const outcomes = recordTaskOutcome(new Map(), "turn-1", "auto_applied");
  const restored = parseTaskOutcomes(JSON.stringify([...outcomes]));
  assert.deepEqual([...turnIdsWithOutcome(restored, "auto_applied")], ["turn-1"]);
});

test("회의록은 이번에 만들어진 것만 한 번 자동 저장한다", () => {
  const input = { isEnabled: true, phase: "ready", wasGenerating: true, hasNotes: true, isAlreadyTried: false };
  assert.equal(shouldAutoSaveMeetingNotes(input), true);
  assert.equal(shouldAutoSaveMeetingNotes({ ...input, isEnabled: false }), false);
  // 지난 회의를 다시 연 경우
  assert.equal(shouldAutoSaveMeetingNotes({ ...input, wasGenerating: false }), false);
  // 저장에 실패해 돌아온 경우: 자동으로 다시 저장하지 않는다.
  assert.equal(shouldAutoSaveMeetingNotes({ ...input, isAlreadyTried: true }), false);
  assert.equal(shouldAutoSaveMeetingNotes({ ...input, phase: "applied" }), false);
  assert.equal(shouldAutoSaveMeetingNotes({ ...input, hasNotes: false }), false);
});

test("스킬 초안은 안전 검토를 통과하고 입력이 온전할 때만 자동 게시한다", () => {
  const input = { isEnabled: true, outcome: "pass", validationErrorCount: 0, isSkillListLoaded: true, isFormUnchanged: true, isEditorOpen: true };
  assert.equal(shouldAutoPublishSkillDraft(input), true);
  assert.equal(shouldAutoPublishSkillDraft({ ...input, isEnabled: false }), false);
  assert.equal(shouldAutoPublishSkillDraft({ ...input, outcome: "review" }), false);
  assert.equal(shouldAutoPublishSkillDraft({ ...input, outcome: "clarify" }), false);
  assert.equal(shouldAutoPublishSkillDraft({ ...input, validationErrorCount: 1 }), false);
  // 기존 커맨드와 겹치는지 아직 모르면 사람이 확인한다.
  assert.equal(shouldAutoPublishSkillDraft({ ...input, isSkillListLoaded: false }), false);
  // 요청한 뒤 입력을 고쳤거나 시트를 닫았으면 그 초안은 확인 없이 게시하지 않는다.
  assert.equal(shouldAutoPublishSkillDraft({ ...input, isFormUnchanged: false }), false);
  assert.equal(shouldAutoPublishSkillDraft({ ...input, isEditorOpen: false }), false);
});

test("다시 확인도 보낼 때처럼 자동 승인 설정을 다시 받은 뒤 결과를 판단한다", () => {
  const source = readFileSync(new URL("../src/widgets/agent-panel/model/useAgentTurn.ts", import.meta.url), "utf8");
  const resume = source.slice(source.indexOf("function resumeFollowing("), source.indexOf("const submitAgentTurn"));
  assert.match(resume, /queryClient\.invalidateQueries\(\{ queryKey: AGENT_AUTO_APPROVAL_QUERY_KEY \}\)/);
  assert.ok(resume.indexOf("invalidateQueries") < resume.indexOf("resumeAgentTurn("), "결과 조회보다 먼저 다시 받는다");
});

test("제안이 0건인 편집 응답 카드에는 수락을 두지 않는다", () => {
  const card = readFileSync(new URL("../src/features/agent-chat/ui/MarkdownEditPreview.tsx", import.meta.url), "utf8");
  assert.match(card, /\{hasProposals && \(\s*<button[^>]*is-primary/);
  const panel = readFileSync(new URL("../src/widgets/agent-panel/ui/AgentPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /<MarkdownEditPreview[\s\S]*?hasProposals=\{proposalCount > 0\}/);
});
