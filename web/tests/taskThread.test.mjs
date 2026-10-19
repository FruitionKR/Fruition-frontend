import assert from "node:assert/strict";
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
  isServerAppliableTask,
  isTaskMessage,
  parseSkillSlashQuery,
  resolveSubmitRoute,
  resolveTaskStatus,
  selectionChipLabel,
  splitChatAndTaskMessages,
  taskKindLabel
} = await import("../src/features/agent-chat/lib/taskThread.ts");

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
  for (const action of ["markdown_edit", "markdown_create", "folder_organize", "workspace_workflow", "clarify", "reject", "skill_authoring"]) {
    assert.equal(isTaskMessage(message({ action, run_id: "agent_1" })), true, action);
  }
  // 진행 중인 agent turn은 action이 아직 없다.
  assert.equal(isTaskMessage(message({ status: "pending", run_id: "agent_9" })), true);
  assert.equal(isTaskMessage(message({ status: "pending", run_id: "query_9" })), false);
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
    { key: "p2", pairId: "p2", turnId: "agent_2", action: "folder_organize", request: "문서를 주제별 폴더로 정리해줘", answer: "계획을 만들었습니다.", messageStatus: "completed", createdAt: null },
    { key: "p3", pairId: "p3", turnId: "agent_3", action: "clarify", request: "고쳐줘", answer: "어느 문서를 고칠까요?", messageStatus: "completed", createdAt: "2026-10-19T01:00:00Z" }
  ]);
});

test("폴더 정리 run 상태를 Figma 묶음·문구로 바꾼다", () => {
  const plan = (runStatus, operationCount = 0) => resolveTaskStatus({ action: "folder_organize", messageStatus: "completed", runStatus, operationCount });
  assert.deepEqual(plan(undefined), { group: "running", label: "계획 불러오는 중", tone: "muted", struck: false });
  assert.deepEqual(plan("awaiting_approval"), { group: "approval", label: "승인 대기", tone: "primary", struck: false });
  assert.deepEqual(plan("executing"), { group: "running", label: "실행 중", tone: "primary", struck: false });
  assert.deepEqual(plan("completed", 5), { group: "done", label: "저장됨(5)", tone: "primary", struck: false });
  assert.deepEqual(plan("rejected"), { group: "done", label: "거절됨", tone: "danger", struck: true });
  assert.deepEqual(plan("clarification_required"), { group: "clarify", label: "추가 설명 필요", tone: "primary", struck: false });
  assert.deepEqual(plan("partial_failed"), { group: "failed", label: "일부 작업 실패", tone: "danger", struck: true });
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
