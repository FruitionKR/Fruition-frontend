import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  }
});

const {
  buildSkillPickerGroups,
  collectServerAppliedTurnIds,
  describeTaskRequest,
  groupTaskEntries,
  isAnswerTask,
  isAttachmentTargetClarification,
  withReadOnlyDocumentClarification,
  isServerAppliableTask,
  isTaskMessage,
  parseSkillSlashQuery,
  resolveSubmitRoute,
  resolveTaskRequest,
  skillSheetPanelView,
  resolveTaskStatus,
  selectionChipLabel,
  splitChatAndTaskMessages,
  supersededTaskKeys,
  taskHeadingKind,
  taskKindLabel
} = await import("../src/features/agent-chat/lib/taskThread.ts");
const {
  READ_ONLY_REQUEST_LIMIT,
  readOnlyRequestStorageKey,
  readReadOnlyRequests,
  recordReadOnlyRequest,
  writeReadOnlyRequest
} = await import("../src/features/agent-chat/lib/readOnlyRequests.ts");

function message(overrides) {
  return { id: overrides.id ?? `msg_${Math.random()}`, role: "assistant", content: "", status: "completed", references: [], ...overrides };
}

test("채팅 탭은 문서가 열려 있어도 항상 질의, 작업 탭은 항상 agent turn으로 보낸다", () => {
  assert.equal(resolveSubmitRoute("chat", "이 문단을 고쳐줘"), "query");
  assert.equal(resolveSubmitRoute("work", "폴더를 정리해줘"), "task");
  assert.equal(resolveSubmitRoute("work", "/summarize 요약해줘"), "task");
  assert.equal(resolveSubmitRoute("work", "  "), null);
  assert.equal(resolveSubmitRoute("chat", ""), null);
  // "/"만 있으면 스킬 고르기를 닫을 뿐 보내지 않는다.
  assert.equal(resolveSubmitRoute("work", "/"), null);
});

test("질의 메시지(action 없음)와 옛 agent 채팅 답변은 채팅 탭, 편집·정리·되물음은 작업 탭에 둔다", () => {
  assert.equal(isTaskMessage(message({ run_id: "query_1" })), false);
  assert.equal(isTaskMessage(message({ action: "chat_answer", run_id: "agent_1" })), false);
  assert.equal(isTaskMessage(message({ action: "conversation_reply", run_id: "agent_1" })), false);
  for (const action of ["markdown_edit", "markdown_create", "folder_organize", "folder_lookup", "workspace_workflow", "clarify", "reject", "skill_authoring"]) {
    assert.equal(isTaskMessage(message({ action, run_id: "agent_1" })), true, action);
  }
  // 진행 중인 agent turn은 action이 아직 없다.
  assert.equal(isTaskMessage(message({ status: "pending", run_id: "agent_9" })), true);
  assert.equal(isTaskMessage(message({ status: "pending", run_id: "query_9" })), false);
  // 진행 중에 취소돼 서버가 닫은 turn(action 없음)도 작업 탭에 남는다. 취소된 질의는 채팅 탭이다.
  assert.equal(isTaskMessage(message({ status: "cancelled", run_id: "agent_9" })), true);
  assert.equal(isTaskMessage(message({ status: "cancelled", run_id: "query_9" })), false);
  // 실패로 끝난 agent turn(action 없음, 스킬 실행 markdown_output_contract_failed 등)도 새로 고침 뒤까지 작업 탭에 남는다.
  assert.equal(isTaskMessage(message({ status: "failed", run_id: "agent_9" })), true);
  assert.equal(isTaskMessage(message({ status: "completed", run_id: "agent_9" })), true);
  assert.equal(isTaskMessage(message({ status: "failed", run_id: "query_9" })), false);
  // 작업 탭에서 보낸 turn은 서버가 채팅 답변으로 돌려줘도 작업 탭에 남긴다(mode=task 미배포 서버).
  assert.equal(isTaskMessage(message({ action: "chat_answer", run_id: "agent_2" }), new Set(["agent_2"])), true);
});

test("세션 메시지를 문답 단위로 채팅·작업으로 나누고 작업 항목에 원래 요청·답을 담는다", () => {
  const messages = [
    message({ id: "u1", role: "user", content: "아동 발달 논문 찾아줘", pair_id: "p1" }),
    message({ id: "a1", content: "근거 답변", pair_id: "p1", run_id: "query_1" }),
    message({ id: "u2", role: "user", content: "  문서를 주제별 폴더로 정리해줘 ", pair_id: "p2", run_id: "agent_2" }),
    message({ id: "a2", content: "계획을 만들었습니다.", pair_id: "p2", run_id: "agent_2", action: "folder_organize" }),
    message({ id: "u3", role: "user", content: "고쳐줘", pair_id: "p3", run_id: "agent_3", created_at: "2026-10-19T01:00:00Z" }),
    message({ id: "a3", content: "어느 문서를 고칠까요?", pair_id: "p3", run_id: "agent_3", action: "clarify" })
  ];
  const { chatMessages, taskItems } = splitChatAndTaskMessages(messages);
  assert.deepEqual(chatMessages.map((item) => item.id), ["u1", "a1"]);
  assert.deepEqual(taskItems, [
    { key: "p2", pairId: "p2", turnId: "agent_2", action: "folder_organize", clarifyReason: null, readOnlyDocumentId: null, request: "문서를 주제별 폴더로 정리해줘", answer: "계획을 만들었습니다.", references: [], messageStatus: "completed", createdAt: null },
    { key: "p3", pairId: "p3", turnId: "agent_3", action: "clarify", clarifyReason: null, readOnlyDocumentId: null, request: "고쳐줘", answer: "어느 문서를 고칠까요?", references: [], messageStatus: "completed", createdAt: "2026-10-19T01:00:00Z" }
  ]);
});

test("폴더 정리 run 상태를 Figma 묶음·문구로 바꾼다", () => {
  const plan = (runStatus, operationCount = 0) => resolveTaskStatus({ action: "folder_organize", messageStatus: "completed", runStatus, operationCount });
  assert.deepEqual(plan(undefined), { group: "running", label: "계획 불러오는 중", tone: "muted", struck: false });
  assert.deepEqual(plan("awaiting_approval"), { group: "approval", label: "승인 대기", tone: "primary", struck: false });
  assert.deepEqual(plan("executing"), { group: "running", label: "실행 중", tone: "primary", struck: false });
  assert.deepEqual(plan("completed", 5), { group: "done", label: "저장됨(5)", tone: "primary", struck: false });
  // 4개 중 1개를 고르지 않았으면 저장된 3개만 세고 제외 수를 덧붙인다.
  assert.deepEqual(
    resolveTaskStatus({ action: "folder_organize", messageStatus: "completed", runStatus: "completed", operationCount: 3, excludedCount: 1 }),
    { group: "done", label: "저장됨(3) · 제외 1", tone: "primary", struck: false }
  );
  assert.deepEqual(plan("rejected"), { group: "done", label: "거절됨", tone: "danger", struck: true });
  assert.deepEqual(plan("clarification_required"), { group: "clarify", label: "추가 설명 필요", tone: "primary", struck: false });
  // 일부는 저장됐으므로 '실패' 묶음에 넣거나 취소선을 긋지 않는다.
  assert.deepEqual(plan("partial_failed"), { group: "partial_failed", label: "일부 실패", tone: "danger", struck: false });
  assert.deepEqual(plan("failed"), { group: "failed", label: "실행 실패", tone: "danger", struck: true });
});

test("문서 편집·되물음·실패 작업의 상태를 정한다", () => {
  const base = { messageStatus: "completed" };
  assert.equal(resolveTaskStatus({ ...base, action: "markdown_edit", hasActivePreview: true }).group, "approval");
  assert.deepEqual(resolveTaskStatus({ ...base, action: "markdown_edit", isApplied: true }), { group: "done", label: "저장됨", tone: "primary", struck: false });
  assert.deepEqual(resolveTaskStatus({ ...base, action: "markdown_edit", isRejected: true }), { group: "done", label: "거절됨", tone: "danger", struck: true });
  assert.equal(resolveTaskStatus({ ...base, action: "markdown_create" }).label, "제안 완료");
  assert.equal(resolveTaskStatus({ ...base, action: "clarify" }).group, "clarify");
  assert.equal(resolveTaskStatus({ ...base, action: "reject" }).group, "failed");
  assert.equal(resolveTaskStatus({ action: "markdown_edit", messageStatus: "pending" }).group, "running");
  assert.deepEqual(resolveTaskStatus({ action: "folder_organize", messageStatus: "failed" }), { group: "failed", label: "실패", tone: "danger", struck: true });
});

test("작업을 할 일이 남은 묶음부터 나열하고 빈 묶음은 뺀다", () => {
  const entry = (key, group) => ({ key, status: { group, label: "", tone: "primary", struck: false } });
  const sections = groupTaskEntries([entry("a", "done"), entry("b", "approval"), entry("c", "done"), entry("d", "clarify")]);
  assert.deepEqual(sections.map((section) => [section.label, section.entries.map((item) => item.key)]), [
    ["확인 필요", ["b"]],
    ["선택 필요", ["d"]],
    ["완료", ["a", "c"]]
  ]);
});

test("작업 카드 머리글은 종류와 스킬, 따옴표 안에는 나머지 요청을 둔다", () => {
  assert.deepEqual(describeTaskRequest("markdown_edit", "/research-summary 연구 개요를 핵심만 3문장으로 정리해줘"), {
    heading: "문서 : /research-summary",
    quote: "연구 개요를 핵심만 3문장으로 정리해줘"
  });
  assert.deepEqual(describeTaskRequest("folder_organize", "/file-organize"), { heading: "문서 : /file-organize", quote: "/file-organize" });
  assert.deepEqual(describeTaskRequest("folder_organize", "/file-organize 날짜_분류_제목 형식으로"), { heading: "문서 : /file-organize", quote: "날짜_분류_제목 형식으로" });
  assert.deepEqual(describeTaskRequest("folder_organize", "폴더를 정리해줘"), { heading: "폴더 정리", quote: "폴더를 정리해줘" });
  assert.deepEqual(describeTaskRequest(null, "폴더를 정리해줘"), { heading: "작업", quote: "폴더를 정리해줘" });
});

test("작업 종류 라벨", () => {
  assert.equal(taskKindLabel("folder_organize"), "폴더 정리");
  assert.equal(taskKindLabel("markdown_edit"), "문서");
  assert.equal(taskKindLabel(null), "작업");
  assert.equal(taskKindLabel("folder_lookup"), "폴더 내용 확인");
});

test("폴더 내용 조회(folder_lookup)는 완료 묶음의 답변으로 두고, 답을 카드로 보일 작업으로 고른다", () => {
  const answer = "'회의록' 폴더(회의록)에 문서 1개가 있어요.\n\n- 킥오프";
  const messages = [
    message({ id: "u1", role: "user", content: "회의록 폴더에 뭐가 있어?", pair_id: "p1", run_id: "agent_1" }),
    message({ id: "a1", content: answer, pair_id: "p1", run_id: "agent_1", action: "folder_lookup" })
  ];
  const { chatMessages, taskItems } = splitChatAndTaskMessages(messages);
  assert.deepEqual(chatMessages, []);
  assert.equal(taskItems[0].action, "folder_lookup");
  assert.equal(taskItems[0].answer, answer);
  assert.deepEqual(
    resolveTaskStatus({ action: "folder_lookup", messageStatus: "completed", hasLaterTask: true }),
    { group: "done", label: "답변", tone: "muted", struck: false }
  );
  assert.equal(isAnswerTask(taskItems[0]), true);
  assert.equal(isAnswerTask({ ...taskItems[0], answer: "" }), false);
  assert.equal(isAnswerTask({ ...taskItems[0], messageStatus: "failed" }), false);
  assert.equal(isAnswerTask({ ...taskItems[0], action: "clarify" }), false);
  // 첨부 문서를 근거로 한 답(chat_answer·conversation_reply)도 한 줄로 접지 않고 답을 보여 준다.
  assert.equal(isAnswerTask({ ...taskItems[0], action: "chat_answer" }), true);
  assert.equal(isAnswerTask({ ...taskItems[0], action: "conversation_reply" }), true);
  assert.equal(isAnswerTask({ ...taskItems[0], action: "markdown_edit" }), false);
  assert.equal(taskHeadingKind("folder_lookup", "회의록 폴더에 뭐가 있어?"), "폴더 내용 확인");
});

test("입력이 / 또는 /검색어뿐일 때만 스킬 고르기를 연다", () => {
  assert.equal(parseSkillSlashQuery("/"), "");
  assert.equal(parseSkillSlashQuery("/Meet"), "meet");
  assert.equal(parseSkillSlashQuery("/meeting 요약해줘"), null);
  assert.equal(parseSkillSlashQuery("폴더 /정리"), null);
  assert.equal(parseSkillSlashQuery(""), null);
});

test("사용 중인 스킬을 문서·폴더 정리 묶음으로 나누고 검색어로 거른다", () => {
  const skill = (slug, description, capabilities, status = "enabled") => ({
    id: `skill_${slug}`, slug, status, scope_type: "personal",
    enabled_version: status === "enabled" ? { description, capabilities } : null,
    latest_version: { description, capabilities }
  });
  const skills = [
    skill("meeting-summary", "회의 내용을 정해진 형식으로 정리합니다.", ["document-create"]),
    skill("file-organize", "폴더의 파일을 규칙에 맞게 이름 바꾸고 분류합니다.", ["folder-organize"]),
    skill("draft", "꺼진 스킬", ["document-edit"], "disabled")
  ];
  assert.deepEqual(buildSkillPickerGroups(skills, ""), [
    { kind: "document", label: "문서", items: [{ id: "skill_meeting-summary", slug: "meeting-summary", description: "회의 내용을 정해진 형식으로 정리합니다." }] },
    { kind: "folder", label: "폴더 정리", items: [{ id: "skill_file-organize", slug: "file-organize", description: "폴더의 파일을 규칙에 맞게 이름 바꾸고 분류합니다." }] }
  ]);
  assert.deepEqual(buildSkillPickerGroups(skills, "file").map((group) => group.kind), ["folder"]);
  assert.deepEqual(buildSkillPickerGroups(skills, "형식").map((group) => group.items[0].slug), ["meeting-summary"]);
  assert.deepEqual(buildSkillPickerGroups(skills, "없는"), []);
});

test("선택 칩은 선택한 첫 줄을 짧게 보여 준다", () => {
  const markdown = "# 연구\n\n## 연구 개요 문단입니다\n본문";
  assert.equal(selectionChipLabel(markdown, 3, 4), "선택 : 연구 개요 문단입니다");
  assert.equal(selectionChipLabel(markdown, 3, 4, 6), "선택 : 연구 개요 …");
  assert.equal(selectionChipLabel("\n\n", 1, 2), "선택 : 1~2줄");
});

test("되물음 뒤에 다른 작업을 보냈으면 선택 필요에 남기지 않고 완료(지난 질문)로 내린다", () => {
  const base = { action: "clarify", messageStatus: "completed" };
  assert.equal(resolveTaskStatus(base).group, "clarify");
  assert.equal(resolveTaskStatus({ ...base, hasLaterTask: false }).label, "답변 필요");
  assert.deepEqual(resolveTaskStatus({ ...base, hasLaterTask: true }), { group: "done", label: "지난 질문", tone: "muted", struck: false });
  // 되물음이 아닌 작업은 뒤 작업과 상관없이 같은 상태다.
  assert.equal(resolveTaskStatus({ action: "markdown_edit", messageStatus: "completed", hasLaterTask: true }).label, "제안 완료");
});

test("서버 버전 기록의 operation_id가 turn의 apply_operation_id와 같으면 적용(저장됨)으로 본다", () => {
  const targets = [
    { turnId: "agent_applied", documentId: "doc_a", applyOperationId: "apply_1" },
    { turnId: "agent_not_applied", documentId: "doc_a", applyOperationId: "apply_2" },
    { turnId: "agent_unknown_doc", documentId: "doc_b", applyOperationId: "apply_3" },
    { turnId: "agent_no_document", documentId: null, applyOperationId: null }
  ];
  const versions = new Map([["doc_a", [{ operation_id: null }, { operation_id: "apply_1" }]]]);
  assert.deepEqual([...collectServerAppliedTurnIds(targets, versions)], ["agent_applied"]);
  assert.deepEqual([...collectServerAppliedTurnIds(targets, new Map())], []);
});

test("서버 적용 확인은 끝난 문서 편집 작업만 대상으로 한다", () => {
  assert.equal(isServerAppliableTask({ action: "markdown_edit", messageStatus: "completed", turnId: "agent_1" }), true);
  assert.equal(isServerAppliableTask({ action: "markdown_edit", messageStatus: "pending", turnId: "agent_1" }), false);
  assert.equal(isServerAppliableTask({ action: "markdown_edit", messageStatus: "completed", turnId: null }), false);
  assert.equal(isServerAppliableTask({ action: "clarify", messageStatus: "completed", turnId: "agent_1" }), false);
});

test("스킬 시트가 열리면 작업 탭으로 옮기고 원래 탭을 기억했다가, 닫히면 그 탭으로 돌린다", () => {
  const opened = skillSheetPanelView(true, "chat", null);
  assert.deepEqual(opened, { view: "work", saved: "chat" });
  // 열린 동안 다시 계산돼도 처음 기억한 탭을 지킨다.
  assert.deepEqual(skillSheetPanelView(true, "work", opened.saved), { view: "work", saved: "chat" });
  assert.deepEqual(skillSheetPanelView(false, "work", opened.saved), { view: "chat", saved: null });
  // 작업 탭에서 열었으면 닫아도 작업 탭이다.
  assert.deepEqual(skillSheetPanelView(false, "work", skillSheetPanelView(true, "work", null).saved), { view: "work", saved: null });
  // 시트 없이 처음 마운트되면 탭을 바꾸지 않는다.
  assert.deepEqual(skillSheetPanelView(false, "chat", null), { view: "chat", saved: null });
});

test("스킬로 보낸 작업의 새 문서·문서 수정 되묻기에는 커맨드를 붙인 두 답을 만든다", async () => {
  const { SKILL_MODE_CHOICES, skillModeAnswer, skillModeQuestionSlug } = await import("../src/features/agent-chat/lib/taskThread.ts");
  const question = "새 문서로 만들까요, 지금 문서를 수정할까요?";
  assert.equal(skillModeQuestionSlug({ action: "clarify", request: "/summary-maker", answer: question }), "summary-maker");
  assert.equal(skillModeQuestionSlug({ action: "clarify", request: "/any 정리해 줘", answer: question }), "any");
  // 스킬이 아니거나, 다른 되묻기거나, 되묻기가 아니면 선택을 두지 않는다.
  assert.equal(skillModeQuestionSlug({ action: "clarify", request: "요약해 줘", answer: question }), null);
  assert.equal(skillModeQuestionSlug({ action: "clarify", request: "/polish", answer: "수정할 문서를 열어 주세요." }), null);
  assert.equal(skillModeQuestionSlug({ action: "markdown_edit", request: "/polish", answer: question }), null);
  assert.deepEqual(SKILL_MODE_CHOICES.map((choice) => skillModeAnswer("summary-maker", choice)), [
    "/summary-maker 새 문서로 만들어 줘",
    "/summary-maker 지금 문서를 수정해 줘"
  ]);
});

test("resolveTaskRequest는 스킬 요청이면 AI가 다시 쓴 요약 대신 보낸 원문을 머리글용으로 쓴다", () => {
  const rewritten = "'squash-names' Skill의 지침에 따라 이 폴더를 정리해 주세요.";
  const resolved = resolveTaskRequest("/squash-names", rewritten);
  assert.deepEqual(resolved, { request: "/squash-names", summary: rewritten });
  assert.deepEqual(describeTaskRequest("folder_organize", resolved.request), { heading: "문서 : /squash-names", quote: "/squash-names" });
  // 요약이 원문과 같으면 따로 돌려주지 않는다.
  assert.deepEqual(resolveTaskRequest(" /squash-names ", "/squash-names"), { request: "/squash-names", summary: null });
  // 스킬 요청이 아니면 지금처럼 요약을 먼저 쓴다.
  assert.deepEqual(resolveTaskRequest("정리해 줘", "보고서 폴더를 주제별로 정리"), { request: "보고서 폴더를 주제별로 정리", summary: null });
  assert.deepEqual(resolveTaskRequest("정리해 줘", null), { request: "정리해 줘", summary: null });
  assert.deepEqual(resolveTaskRequest("", "  "), { request: "요청 내용 없음", summary: null });
});

test("초안을 취소한 편집·새 문서 작업은 '제안 완료' 대신 '취소됨'으로 보인다", () => {
  const cancelled = resolveTaskStatus({ action: "markdown_create", messageStatus: "completed", isCancelled: true });
  assert.equal(cancelled.label, "취소됨");
  assert.equal(cancelled.group, "done");
  // 저장·거절 기록이 있으면 그쪽이 먼저다.
  assert.equal(resolveTaskStatus({ action: "markdown_edit", messageStatus: "completed", isApplied: true, isCancelled: true }).label, "저장됨");
  assert.equal(resolveTaskStatus({ action: "markdown_edit", messageStatus: "completed", isRejected: true, isCancelled: true }).label, "거절됨");
  assert.equal(resolveTaskStatus({ action: "markdown_create", messageStatus: "completed" }).label, "제안 완료");
});

test("스킬 실행 카드 머리글은 action이 정해지기 전(진행 중)과 뒤가 같다", () => {
  // 진행 중 카드는 action이 아직 없다(null).
  assert.deepEqual(describeTaskRequest(null, "/file-organize"), { heading: "문서 : /file-organize", quote: "/file-organize" });
  for (const action of ["folder_organize", "markdown_edit", "markdown_create", "clarify", null]) {
    assert.equal(taskHeadingKind(action, "/file-organize"), "문서");
    assert.equal(describeTaskRequest(action, "/file-organize 날짜순").heading, "문서 : /file-organize");
  }
  // 스킬이 아닌 요청은 action별 라벨을 그대로 쓴다.
  assert.equal(taskHeadingKind("folder_organize", "폴더를 정리해줘"), "폴더 정리");
  assert.equal(taskHeadingKind(null, "폴더를 정리해줘"), "작업");
});

test("폴더 정리 완료 행은 새 폴더 수를 따로 적는다", () => {
  assert.deepEqual(
    resolveTaskStatus({ action: "folder_organize", messageStatus: "completed", runStatus: "completed", operationCount: 3, excludedCount: 1, createdFolderCount: 2 }),
    { group: "done", label: "저장됨(3) · 제외 1 · 새 폴더 2", tone: "primary", struck: false }
  );
});

test("응답을 받지 못한 turn은 실패 묶음에 두고, 닫으면 완료 묶음의 '중단됨'으로 옮긴다", () => {
  const base = { action: null, messageStatus: "pending" };
  assert.equal(resolveTaskStatus(base).group, "running");
  assert.deepEqual(resolveTaskStatus({ ...base, isStalled: true }), { group: "failed", label: "응답을 받지 못했어요", tone: "danger", struck: false });
  assert.deepEqual(resolveTaskStatus({ ...base, isStalled: true, isReleased: true }), { group: "done", label: "중단됨", tone: "muted", struck: true });
});

test("같은 스킬을 같은 폴더에 다시 실행해 끝나면 앞의 '추가 설명 필요'를 '다시 실행됨'으로 완료에 옮긴다", () => {
  const items = [
    { key: "a", request: "/file-organize", messageStatus: "completed", target: "folder_a" },
    { key: "b", request: "/other", messageStatus: "completed", target: "folder_a" },
    { key: "c", request: "/file-organize 날짜별로", messageStatus: "completed", target: "folder_a" },
    { key: "d", request: "폴더 정리해줘", messageStatus: "completed", target: "folder_a" },
    { key: "e", request: "폴더 정리해줘", messageStatus: "pending", target: "folder_a" }
  ];
  const targetOf = (item) => item.target;
  // c가 a를 대신한다. d 뒤의 같은 요청(e)은 아직 진행 중이라 d를 대신하지 않는다.
  assert.deepEqual([...supersededTaskKeys(items, targetOf)], ["a"]);
  assert.deepEqual(supersededTaskKeys([
    { key: "x", request: "/s", messageStatus: "completed", target: "f" },
    { key: "y", request: "/s", messageStatus: "failed", target: "f" }
  ], targetOf), new Set());
  const clarify = { action: "folder_organize", messageStatus: "completed", runStatus: "clarification_required" };
  assert.equal(resolveTaskStatus(clarify).group, "clarify");
  assert.deepEqual(resolveTaskStatus({ ...clarify, isSuperseded: true }), { group: "done", label: "다시 실행됨", tone: "muted", struck: false });
});

test("다른 폴더에 같은 스킬을 실행해 끝나도 앞 폴더의 되묻기 카드는 그대로 둔다", () => {
  const targetOf = (item) => item.target;
  const otherFolder = [
    { key: "a", request: "/tidy-names", messageStatus: "completed", target: "folder_a" },
    { key: "b", request: "/tidy-names", messageStatus: "completed", target: "folder_b" }
  ];
  assert.deepEqual(supersededTaskKeys(otherFolder, targetOf), new Set());
  // 같은 폴더에 다시 실행하면 대신한다.
  assert.deepEqual(supersededTaskKeys([...otherFolder, { key: "c", request: "/tidy-names", messageStatus: "completed", target: "folder_a" }], targetOf), new Set(["a"]));
  // 대상을 모르면(계획을 아직 못 받음) 정리하지 않는다.
  assert.deepEqual(supersededTaskKeys([
    { key: "a", request: "/tidy-names", messageStatus: "completed", target: "folder_a" },
    { key: "b", request: "/tidy-names", messageStatus: "completed", target: null }
  ], targetOf), new Set());
  assert.deepEqual(supersededTaskKeys([
    { key: "a", request: "/tidy-names", messageStatus: "completed", target: null },
    { key: "b", request: "/tidy-names", messageStatus: "completed", target: null }
  ], targetOf), new Set());
});

test("서버가 취소로 닫은(cancelled) turn은 완료 묶음의 '취소됨'으로, 닫거나 막혀도 같게 보인다", () => {
  const cancelled = { group: "done", label: "취소됨", tone: "muted", struck: true };
  assert.deepEqual(resolveTaskStatus({ action: null, messageStatus: "cancelled" }), cancelled);
  assert.deepEqual(resolveTaskStatus({ action: null, messageStatus: "cancelled", isStalled: true, isReleased: true }), cancelled);
  assert.deepEqual(resolveTaskStatus({ action: "folder_organize", messageStatus: "cancelled" }), cancelled);
  // 편집안 초안을 취소한 것과 같은 문구다.
  assert.equal(resolveTaskStatus({ action: "markdown_edit", messageStatus: "completed", isCancelled: true }).label, "취소됨");
});

test("실패한 스킬 실행 turn은 작업 탭 '실패' 묶음에 서버 안내 문구와 함께 들어간다", () => {
  const messages = [
    message({ id: "u1", role: "user", content: "/polish-intro", pair_id: "p1" }),
    message({ id: "a1", pair_id: "p1", run_id: "agent_x", status: "failed", content: "", error_message: "편집안을 만들지 못했습니다. 다시 시도해 주세요." }),
    message({ id: "u2", role: "user", content: "회의 정리해 줘", pair_id: "p2" }),
    message({ id: "a2", pair_id: "p2", run_id: "query_y", content: "답" })
  ];
  const { chatMessages, taskItems } = splitChatAndTaskMessages(messages);
  assert.deepEqual(chatMessages.map((item) => item.id), ["u2", "a2"]);
  assert.equal(taskItems.length, 1);
  assert.equal(taskItems[0].turnId, "agent_x");
  assert.equal(taskItems[0].request, "/polish-intro");
  assert.equal(taskItems[0].answer, "편집안을 만들지 못했습니다. 다시 시도해 주세요.");
  assert.equal(resolveTaskStatus({ action: taskItems[0].action, messageStatus: taskItems[0].messageStatus }).group, "failed");
});

test("서버가 취소를 받아들인 turn은 목록이 아직 pending이어도 '중단됨'이 아니라 '취소됨'이다", () => {
  const cancelled = { group: "done", label: "취소됨", tone: "muted", struck: true };
  assert.deepEqual(resolveTaskStatus({ action: null, messageStatus: "pending", isCancelAccepted: true, isReleased: true }), cancelled);
  assert.deepEqual(resolveTaskStatus({ action: null, messageStatus: "pending", isCancelAccepted: true, isStalled: true }), cancelled);
  assert.equal(resolveTaskStatus({ action: null, messageStatus: "pending", isReleased: true }).label, "중단됨");
});

test("취소한 turn은 되돌리는 동안 '진행 중' 묶음의 '취소하는 중…', 끝나면 '취소됨', 복구 실패면 '실패' 묶음이다", () => {
  const cancelling = { group: "running", label: "취소하는 중…", tone: "muted", struck: false };
  const cancelled = { group: "done", label: "취소됨", tone: "muted", struck: true };
  const rollbackFailed = { group: "failed", label: "변경 복구 실패", tone: "danger", struck: false };
  // 서버는 말풍선을 취소 요청 즉시 cancelled로 닫으므로 turn 조회 상태를 따른다.
  assert.deepEqual(resolveTaskStatus({ action: null, messageStatus: "cancelled", cancelState: "requested" }), cancelling);
  assert.deepEqual(resolveTaskStatus({ action: null, messageStatus: "cancelled", cancelState: "rolling_back" }), cancelling);
  assert.deepEqual(resolveTaskStatus({ action: null, messageStatus: "cancelled", cancelState: "cancelled" }), cancelled);
  assert.deepEqual(resolveTaskStatus({ action: null, messageStatus: "cancelled", cancelState: "rollback_failed" }), rollbackFailed);
  // 목록이 아직 pending이어도 취소 응답 상태로 같게 보인다.
  assert.deepEqual(resolveTaskStatus({ action: null, messageStatus: "pending", isCancelAccepted: true, cancelState: "rolling_back" }), cancelling);
  assert.deepEqual(resolveTaskStatus({ action: null, messageStatus: "pending", isCancelAccepted: true, cancelState: "rollback_failed" }), rollbackFailed);
  // 취소를 받아들이지 않은 pending turn은 취소 상태를 보지 않는다.
  assert.equal(resolveTaskStatus({ action: null, messageStatus: "pending", cancelState: "rolling_back" }).label, "진행 중");
});

test("같은 폴더의 새 계획에 대체된 승인 대기·거절 계획은 완료 묶음의 '새 실행으로 대체됨'이다", () => {
  const superseded = { group: "done", label: "새 실행으로 대체됨", tone: "muted", struck: false };
  const base = { action: "folder_organize", messageStatus: "completed", isPlanSuperseded: true };
  assert.deepEqual(resolveTaskStatus({ ...base, runStatus: "awaiting_approval" }), superseded);
  assert.deepEqual(resolveTaskStatus({ ...base, runStatus: "rejected" }), superseded);
  // 승인 처리 중·끝난 계획은 그대로 보인다.
  assert.equal(resolveTaskStatus({ ...base, runStatus: "executing" }).label, "실행 중");
  assert.equal(resolveTaskStatus({ action: "folder_organize", messageStatus: "completed", runStatus: "rejected" }).label, "거절됨");
  assert.equal(resolveTaskStatus({ action: "folder_organize", messageStatus: "completed", runStatus: "awaiting_approval" }).group, "approval");
});

const OPEN_DOCUMENT_QUESTION = "수정할 Markdown 문서를 연 뒤 다시 요청해 주세요.";
const READ_ONLY_REQUESTS = new Map([["turn_a", "doc_read_only"], ["turn_other", "doc_read_only"], ["turn_lookup", "doc_read_only"]]);

test("보기 권한 문서를 연 채 보낸 요청에 AI가 문서를 열라고 되물으면 보기 권한 안내로 바꾼다", () => {
  const openDocumentQuestion = { key: "a", turnId: "turn_a", action: "clarify", clarifyReason: null, answer: OPEN_DOCUMENT_QUESTION };
  const otherQuestion = { key: "b", turnId: "turn_other", action: "clarify", clarifyReason: null, answer: "어떤 기준으로 정리할까요?" };
  const answered = { key: "c", turnId: "turn_lookup", action: "folder_lookup", clarifyReason: null, answer: OPEN_DOCUMENT_QUESTION };
  const result = withReadOnlyDocumentClarification([openDocumentQuestion, otherQuestion, answered], "doc_read_only", READ_ONLY_REQUESTS);
  assert.match(result[0].answer, /^이 문서는 보기 권한만 있어 수정할 수 없어요\./);
  assert.equal(result[1], otherQuestion);
  assert.equal(result[2], answered);
  assert.equal(openDocumentQuestion.answer, OPEN_DOCUMENT_QUESTION);
});

test("첨부한 문서를 고치려 할 때의 되묻기는 같은 이유 코드여도 보기 권한 안내로 바꾸지 않는다", () => {
  const asked = {
    key: "a",
    turnId: "turn_a",
    action: "clarify",
    clarifyReason: "markdown_document_required",
    answer: "첨부한 문서는 참고 자료로만 읽어요. 첨부한 문서를 고치려면 그 문서를 연 뒤 다시 요청해 주세요."
  };
  const [result] = withReadOnlyDocumentClarification([asked], "doc_read_only", READ_ONLY_REQUESTS);
  assert.equal(result, asked);
});

test("작업 항목은 답변의 근거(references)를 함께 가진다", () => {
  const references = [{ id: 1, rank: 1, reference_type: "evidence", source_document_id: "doc1", source_block_ids: [] }];
  const { taskItems: items } = splitChatAndTaskMessages([
    message({ id: "q", role: "user", content: "요약", pair_id: "p1", run_id: "agent_r", action: undefined }),
    message({ id: "a", role: "assistant", content: "답 [1]", pair_id: "p1", run_id: "agent_r", action: "chat_answer", references })
  ], new Set(["agent_r"]));
  assert.deepEqual(items[0].references, references);
});

test("문서 없이 받은 되묻기는 뒤에 보기 권한 문서를 열어도 그대로 둔다", () => {
  const asked = { key: "a", turnId: "turn_no_document", action: "clarify", clarifyReason: null, answer: OPEN_DOCUMENT_QUESTION };
  const [result] = withReadOnlyDocumentClarification([asked], "doc_read_only", READ_ONLY_REQUESTS);
  assert.equal(result, asked);
});

test("다른 보기 권한 문서에서 받은 되묻기는 지금 문서의 이유로 바꾸지 않는다", () => {
  const asked = { key: "a", turnId: "turn_a", action: "clarify", clarifyReason: null, answer: OPEN_DOCUMENT_QUESTION };
  const [result] = withReadOnlyDocumentClarification([asked], "doc_other_read_only", READ_ONLY_REQUESTS);
  assert.equal(result, asked);
});

test("지금 연 문서가 보기 권한이 아니면 AI 되묻기를 그대로 둔다", () => {
  const items = [{ key: "a", turnId: "turn_a", action: "clarify", clarifyReason: null, answer: OPEN_DOCUMENT_QUESTION }];
  assert.equal(withReadOnlyDocumentClarification(items, null, READ_ONLY_REQUESTS), items);
});

const DOCUMENT_REQUIRED = "markdown_document_required";
const READ_ONLY_ANSWER = /^이 문서는 보기 권한만 있어 수정할 수 없어요\./;

test("이유 코드가 문서 필요면 문장이 바뀌어도 그 문서에서 보낸 요청은 보기 권한 안내로 바꾼다", () => {
  const asked = { key: "a", turnId: "turn_a", action: "clarify", clarifyReason: DOCUMENT_REQUIRED, answer: "편집할 문서를 먼저 열어 주세요." };
  const [result] = withReadOnlyDocumentClarification([asked], "doc_read_only", READ_ONLY_REQUESTS);
  assert.match(result.answer, READ_ONLY_ANSWER);
});

test("모르는 이유 코드는 문장이 같아도 다른 이유이니 그대로 둔다", () => {
  const asked = { key: "a", turnId: "turn_a", action: "clarify", clarifyReason: "some_future_reason", answer: OPEN_DOCUMENT_QUESTION };
  const [result] = withReadOnlyDocumentClarification([asked], "doc_read_only", READ_ONLY_REQUESTS);
  assert.equal(result, asked);
});

test("이유 코드가 없으면 문장이 다른 되묻기는 그대로 둔다", () => {
  const asked = { key: "a", turnId: "turn_a", action: "clarify", clarifyReason: null, answer: "어느 문서를 고칠까요?" };
  const [result] = withReadOnlyDocumentClarification([asked], "doc_read_only", READ_ONLY_REQUESTS);
  assert.equal(result, asked);
});

test("이유 코드는 문서가 필요하다는 말뿐이라 문서 없이 받았거나 다른 문서에서 받은 되묻기는 바꾸지 않는다", () => {
  const coded = { action: "clarify", clarifyReason: DOCUMENT_REQUIRED, answer: OPEN_DOCUMENT_QUESTION };
  const noDocument = { ...coded, key: "a", turnId: "turn_no_document" };
  const otherDocument = { ...coded, key: "b", turnId: "turn_a" };
  assert.equal(withReadOnlyDocumentClarification([noDocument], "doc_read_only", READ_ONLY_REQUESTS)[0], noDocument);
  assert.equal(withReadOnlyDocumentClarification([otherDocument], "doc_other_read_only", READ_ONLY_REQUESTS)[0], otherDocument);
  const openElsewhere = [{ ...coded, key: "c", turnId: "turn_a" }];
  assert.equal(withReadOnlyDocumentClarification(openElsewhere, null, READ_ONLY_REQUESTS), openElsewhere);
});

const NO_REQUESTS = new Map();

test("서버가 남긴 문서가 지금 문서면 이 브라우저에 기록이 없어도 보기 권한 안내로 바꾼다(다른 기기·브라우저)", () => {
  const asked = { key: "a", turnId: "turn_new", action: "clarify", clarifyReason: DOCUMENT_REQUIRED, readOnlyDocumentId: "doc_read_only", answer: OPEN_DOCUMENT_QUESTION };
  const [result] = withReadOnlyDocumentClarification([asked], "doc_read_only", NO_REQUESTS);
  assert.match(result.answer, READ_ONLY_ANSWER);
});

test("서버가 남긴 문서가 지금 문서와 다르면 이 브라우저 기록이 같아도 바꾸지 않는다", () => {
  const asked = { key: "a", turnId: "turn_a", action: "clarify", clarifyReason: DOCUMENT_REQUIRED, readOnlyDocumentId: "doc_other_read_only", answer: OPEN_DOCUMENT_QUESTION };
  const [result] = withReadOnlyDocumentClarification([asked], "doc_read_only", READ_ONLY_REQUESTS);
  assert.equal(result, asked);
});

test("서버 값이 있어도 다른 이유의 되묻기와 되묻기가 아닌 답은 바꾸지 않는다", () => {
  const coded = { key: "a", turnId: "turn_new", action: "clarify", clarifyReason: "some_future_reason", readOnlyDocumentId: "doc_read_only", answer: OPEN_DOCUMENT_QUESTION };
  const sentence = { key: "b", turnId: "turn_new", action: "clarify", clarifyReason: null, readOnlyDocumentId: "doc_read_only", answer: "어느 문서를 고칠까요?" };
  const answered = { key: "c", turnId: "turn_new", action: "folder_lookup", clarifyReason: null, readOnlyDocumentId: "doc_read_only", answer: OPEN_DOCUMENT_QUESTION };
  assert.deepEqual(withReadOnlyDocumentClarification([coded, sentence, answered], "doc_read_only", NO_REQUESTS), [coded, sentence, answered]);
});

test("서버 값이 없으면(구 서버·과거 메시지) 이 브라우저 기록으로 판단한다", () => {
  const stored = { key: "a", turnId: "turn_a", action: "clarify", clarifyReason: null, readOnlyDocumentId: null, answer: OPEN_DOCUMENT_QUESTION };
  const unknown = { key: "b", turnId: "turn_unknown", action: "clarify", clarifyReason: null, readOnlyDocumentId: null, answer: OPEN_DOCUMENT_QUESTION };
  const [fromStored, fromUnknown] = withReadOnlyDocumentClarification([stored, unknown], "doc_read_only", READ_ONLY_REQUESTS);
  assert.match(fromStored.answer, READ_ONLY_ANSWER);
  assert.equal(fromUnknown, unknown);
});

test("지금 문서를 편집할 수 있으면 서버 값이 있어도 AI 되묻기를 그대로 둔다", () => {
  const items = [{ key: "a", turnId: "turn_new", action: "clarify", clarifyReason: DOCUMENT_REQUIRED, readOnlyDocumentId: "doc_read_only", answer: OPEN_DOCUMENT_QUESTION }];
  assert.equal(withReadOnlyDocumentClarification(items, null, NO_REQUESTS), items);
});

test("메시지의 보기 전용 문서를 작업 항목으로 옮기고, 값이나 키가 없으면 null이다", () => {
  const pair = (pairId, assistant) => [
    message({ id: `${pairId}_q`, role: "user", content: "수정해줘", pair_id: pairId, run_id: pairId, read_only_document_id: null }),
    message({ id: `${pairId}_a`, action: "clarify", pair_id: pairId, run_id: pairId, ...assistant })
  ];
  const { taskItems } = splitChatAndTaskMessages([
    ...pair("p_value", { read_only_document_id: "doc_read_only" }),
    ...pair("p_null", { read_only_document_id: null }),
    ...pair("p_missing", {})
  ]);
  assert.deepEqual(taskItems.map((item) => item.readOnlyDocumentId), ["doc_read_only", null, null]);
});

test("메시지의 이유 코드를 작업 항목으로 옮기고, 값이 없거나 키가 없으면 문장으로 판단한다", () => {
  const pair = (pairId, runId, assistant) => [
    message({ id: `${pairId}_q`, role: "user", content: "이 문서를 수정해줘", pair_id: pairId, run_id: runId }),
    message({ id: `${pairId}_a`, action: "clarify", pair_id: pairId, run_id: runId, ...assistant })
  ];
  const { taskItems } = splitChatAndTaskMessages([
    ...pair("p_coded", "turn_a", { content: "바뀐 문장", clarify_reason: DOCUMENT_REQUIRED }),
    ...pair("p_null", "turn_other", { content: OPEN_DOCUMENT_QUESTION, clarify_reason: null }),
    ...pair("p_missing", "turn_lookup", { content: OPEN_DOCUMENT_QUESTION })
  ]);
  assert.deepEqual(taskItems.map((item) => item.clarifyReason), [DOCUMENT_REQUIRED, null, null]);
  for (const item of withReadOnlyDocumentClarification(taskItems, "doc_read_only", READ_ONLY_REQUESTS)) {
    assert.match(item.answer, READ_ONLY_ANSWER);
  }
});

test("보기 권한 요청 기록은 새로 고침 뒤에도 읽히고, 깨진 값은 빈 기록으로 본다", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const key = readOnlyRequestStorageKey("ws_1");
  writeReadOnlyRequest(storage, key, "turn_a", "doc_a");
  writeReadOnlyRequest(storage, key, "turn_b", "doc_b");
  assert.deepEqual([...readReadOnlyRequests(storage, key)], [["turn_a", "doc_a"], ["turn_b", "doc_b"]]);
  store.set(key, "{깨짐");
  assert.equal(readReadOnlyRequests(storage, key).size, 0);
  store.set(key, JSON.stringify([["turn_a", 3], ["", "doc"], "x", ["turn_b", "doc_b"]]));
  assert.deepEqual([...readReadOnlyRequests(storage, key)], [["turn_b", "doc_b"]]);
  assert.equal(readReadOnlyRequests(null, key).size, 0);
  assert.doesNotThrow(() => writeReadOnlyRequest({ getItem: () => null, setItem: () => { throw new Error("full"); } }, key, "turn_a", "doc_a"));
});

test("보기 권한 요청 기록은 최근 것만 남긴다", () => {
  let turns = new Map();
  for (let index = 0; index < READ_ONLY_REQUEST_LIMIT + 5; index += 1) turns = recordReadOnlyRequest(turns, `turn_${index}`, "doc");
  assert.equal(turns.size, READ_ONLY_REQUEST_LIMIT);
  assert.equal(turns.has("turn_0"), false);
  assert.equal(turns.has(`turn_${READ_ONLY_REQUEST_LIMIT + 4}`), true);
});

test("요청 시점의 보기 권한 문서를 onAccepted에서 turn과 묶는다", () => {
  const source = readFileSync(new URL("../src/widgets/agent-panel/model/useAgentTurn.ts", import.meta.url), "utf8");
  assert.match(source, /const requestReadOnlyDocumentId = readOnlyDocumentIdRef\.current;[\s\S]*onAccepted: \(requestId\) => \{[\s\S]*rememberReadOnlyRequest\(requestId, requestReadOnlyDocumentId\)/);
});

test("첨부 중 고칠 문서를 못 정해 되물은 이번 turn만 첨부를 되돌릴 대상이다", () => {
  const item = { turnId: "turn_1", action: "clarify", clarifyReason: "attachment_target_required" };
  assert.equal(isAttachmentTargetClarification([item], "turn_1"), true);
  assert.equal(isAttachmentTargetClarification([item], "turn_2"), false, "지난 되묻기는 아니다");
  assert.equal(isAttachmentTargetClarification([item], null), false);
  assert.equal(isAttachmentTargetClarification([{ ...item, clarifyReason: "markdown_document_required" }], "turn_1"), false);
  assert.equal(isAttachmentTargetClarification([{ ...item, action: "markdown_edit" }], "turn_1"), false);
});

test("일부 실패 묶음은 실패 묶음과 따로 '일부 실패'로 보인다", () => {
  const entry = (group) => ({ status: { group, label: "", tone: "danger", struck: false } });
  const sections = groupTaskEntries([entry("failed"), entry("partial_failed")]);
  assert.deepEqual(sections.map((section) => section.label), ["일부 실패", "실패"]);
});
