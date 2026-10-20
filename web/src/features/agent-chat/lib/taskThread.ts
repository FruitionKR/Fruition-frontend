import type { ChatMessageResponse } from "@/entities/chat/model/chat";
import type { SkillResponse } from "@/entities/skill/model/skill";
import { agentPlanStatusLabel, isWorkspacePlanAction, shouldPollAgentPlan } from "@/features/agent-chat/lib/agentPlan";

/**
 * 채팅 탭과 작업 탭의 분리(2026-10-19 계약).
 * 채팅 탭은 위키 질의(Query) 문답만, 작업 탭은 문서 편집·폴더 정리·스킬 실행(agent turn) 문답만 보여 준다.
 * 둘은 같은 채팅 세션 메시지를 나눠 쓴다. 서버는 질의 메시지에 action 키를 빼고, agent turn 메시지에만 action을 넣는다.
 */

/** 채팅 답변으로 남는 agent 갈래. 작업 탭이 생기기 전 문서를 연 채 질문해 agent가 답한 기록이다. */
const CHAT_ANSWER_ACTIONS = new Set(["chat_answer", "conversation_reply"]);
/** agent turn run ID 접두사(document AgentTurnService). 질의 run은 query_로 시작한다. */
const AGENT_RUN_PREFIX = "agent_";

/**
 * 작업 탭에 둘 메시지인지. taskRunIds는 이 화면에서 작업 탭으로 보낸 turn ID다.
 * mode=task를 아직 모르는 서버가 채팅 답변(chat_answer)으로 돌려줘도 보낸 탭(작업)에 남긴다.
 */
export function isTaskMessage(message: ChatMessageResponse, taskRunIds: ReadonlySet<string> = new Set()): boolean {
  if (message.run_id && taskRunIds.has(message.run_id)) return true;
  if (message.action) return !CHAT_ANSWER_ACTIONS.has(message.action);
  return message.status === "pending" && Boolean(message.run_id?.startsWith(AGENT_RUN_PREFIX));
}

export type TaskMessageItem = {
  key: string;
  pairId: string | null;
  /** 이 작업을 만든 agent turn ID. 폴더 정리 계획은 이 ID로 run을 찾는다. */
  turnId: string | null;
  action: string | null;
  /** 사용자가 보낸 원래 요청 */
  request: string;
  /** AI가 남긴 답(편집 요약·되묻는 질문 등) */
  answer: string;
  messageStatus: string;
  /** 요청을 보낸 시각(ISO). 작업 카드의 "방금 전"에 쓴다. */
  createdAt: string | null;
};

function toTaskItem(key: string, pairId: string | null, messages: ChatMessageResponse[]): TaskMessageItem {
  const user = messages.find((message) => message.role === "user");
  const assistant = messages.findLast((message) => message.role === "assistant");
  return {
    key,
    pairId,
    turnId: assistant?.run_id ?? user?.run_id ?? null,
    action: assistant?.action ?? null,
    request: (user?.content ?? "").trim().normalize("NFC"),
    answer: (assistant?.content ?? "").trim().normalize("NFC"),
    messageStatus: assistant?.status ?? user?.status ?? "pending",
    createdAt: user?.created_at ?? assistant?.created_at ?? null
  };
}

/** 세션 메시지를 채팅 탭 메시지와 작업 탭 항목으로 나눈다. 문답(pair) 단위로 함께 옮긴다. */
export function splitChatAndTaskMessages(
  messages: ChatMessageResponse[],
  taskRunIds: ReadonlySet<string> = new Set()
): { chatMessages: ChatMessageResponse[]; taskItems: TaskMessageItem[] } {
  const taskPairIds = new Set(
    messages.flatMap((message) => (message.pair_id && isTaskMessage(message, taskRunIds) ? [message.pair_id] : []))
  );
  const chatMessages: ChatMessageResponse[] = [];
  const taskGroups = new Map<string, ChatMessageResponse[]>();
  for (const message of messages) {
    const isTask = message.pair_id ? taskPairIds.has(message.pair_id) : isTaskMessage(message, taskRunIds);
    if (!isTask) {
      chatMessages.push(message);
      continue;
    }
    const key = message.pair_id ?? message.id;
    taskGroups.set(key, [...(taskGroups.get(key) ?? []), message]);
  }
  const taskItems = [...taskGroups.entries()].map(([key, group]) => toTaskItem(key, group[0].pair_id ?? null, group));
  return { chatMessages, taskItems };
}

/** 작업 종류(Figma 1610:9600 "문서 : …"의 앞부분). */
export function taskKindLabel(action: string | null): string {
  switch (action) {
    case "folder_organize": return "폴더 정리";
    case "workspace_workflow": return "워크스페이스";
    case "markdown_edit":
    case "markdown_create": return "문서";
    case "skill_authoring":
    case "skill_draft_proposal": return "스킬";
    default: return "작업";
  }
}

const SLASH_COMMAND_PATTERN = /^\/([a-z0-9][a-z0-9-]{0,62})(?:\s|$)/;

/** '상황에 맞게' 스킬의 되묻기("새 문서로 만들까요, 지금 문서를 수정할까요?")에 답하는 두 선택. */
export const SKILL_MODE_CHOICES = [
  { label: "새 문서로 만들기", request: "새 문서로 만들어 줘", createsDocument: true },
  { label: "지금 문서 수정", request: "지금 문서를 수정해 줘", createsDocument: false }
] as const;

/**
 * 스킬(`/slug …`)로 보낸 작업에 AI가 새 문서·문서 수정 중 무엇을 할지 되물었으면 그 slug, 아니면 null.
 * 답도 `/slug 새 문서로 만들어 줘`처럼 커맨드를 붙여 보내야 스킬이 유지된다(ai agent.md).
 */
export function skillModeQuestionSlug(item: Pick<TaskMessageItem, "action" | "request" | "answer">): string | null {
  if (item.action !== "clarify") return null;
  const match = SLASH_COMMAND_PATTERN.exec(item.request);
  if (!match) return null;
  return /새 문서/.test(item.answer) && /수정/.test(item.answer) ? match[1] : null;
}

/** 입력이 `/slug` 또는 `/slug 요청`으로 시작하면 그 slug, 아니면 null. */
export function slashCommandSlug(text: string): string | null {
  return SLASH_COMMAND_PATTERN.exec(text.trim())?.[1] ?? null;
}

/** 되묻기 선택 → 작업 탭으로 보낼 요청 문장 */
export function skillModeAnswer(slug: string, choice: (typeof SKILL_MODE_CHOICES)[number]): string {
  return `/${slug} ${choice.request}`;
}

export type TaskGroup = "running" | "approval" | "clarify" | "failed" | "done";

/** Figma 1671:13216처럼 상태별 묶음으로 보여 준다(확인 필요·선택 필요·완료). 할 일이 남은 묶음을 위에 둔다. */
export const TASK_GROUPS: { group: TaskGroup; label: string }[] = [
  { group: "running", label: "진행 중" },
  { group: "approval", label: "확인 필요" },
  { group: "clarify", label: "선택 필요" },
  { group: "failed", label: "실패" },
  { group: "done", label: "완료" }
];

export type TaskStatusView = {
  group: TaskGroup;
  label: string;
  /** primary: 파란 글자, danger: 빨간 글자(취소선은 struck) */
  tone: "primary" | "danger" | "muted";
  struck: boolean;
};

const FAILED_RUN_STATUSES = new Set(["failed", "partial_failed", "conflicted", "rollback_failed"]);

export function resolveTaskStatus({
  action,
  messageStatus,
  runStatus,
  operationCount = 0,
  hasActivePreview = false,
  isApplied = false,
  isRejected = false,
  hasLaterTask = false
}: {
  action: string | null;
  messageStatus: string;
  /** 폴더 정리 계획 run 상태. 아직 받지 못했으면 undefined */
  runStatus?: string;
  operationCount?: number;
  /** 이 화면에서 받은 편집안·새 문서 초안을 아직 검토하는 중인지 */
  hasActivePreview?: boolean;
  /** 편집안을 적용·새 문서로 만들었는지(이 화면의 기록 또는 서버 버전 기록) */
  isApplied?: boolean;
  /** 이 화면에서 편집안을 모두 거절했는지 */
  isRejected?: boolean;
  /** 이 작업 뒤에 보낸 작업이 있는지. 되물음은 다음 요청으로 답했거나 지나간 것으로 본다. */
  hasLaterTask?: boolean;
}): TaskStatusView {
  if (messageStatus === "pending") return { group: "running", label: "진행 중", tone: "primary", struck: false };
  if (messageStatus === "failed") return { group: "failed", label: "실패", tone: "danger", struck: true };
  if (isWorkspacePlanAction(action ?? undefined)) {
    if (!runStatus) return { group: "running", label: agentPlanStatusLabel(undefined), tone: "muted", struck: false };
    if (runStatus === "awaiting_approval") return { group: "approval", label: "승인 대기", tone: "primary", struck: false };
    if (runStatus === "clarification_required") return { group: "clarify", label: "추가 설명 필요", tone: "primary", struck: false };
    if (runStatus === "completed") return { group: "done", label: `저장됨(${operationCount})`, tone: "primary", struck: false };
    if (runStatus === "rejected") return { group: "done", label: "거절됨", tone: "danger", struck: true };
    if (runStatus === "cancelled") return { group: "done", label: "취소됨", tone: "danger", struck: true };
    if (FAILED_RUN_STATUSES.has(runStatus)) return { group: "failed", label: agentPlanStatusLabel(runStatus), tone: "danger", struck: true };
    if (shouldPollAgentPlan(runStatus)) return { group: "running", label: agentPlanStatusLabel(runStatus), tone: "primary", struck: false };
    return { group: "done", label: agentPlanStatusLabel(runStatus), tone: "muted", struck: false };
  }
  if (action === "clarify") {
    return hasLaterTask
      ? { group: "done", label: "지난 질문", tone: "muted", struck: false }
      : { group: "clarify", label: "답변 필요", tone: "primary", struck: false };
  }
  if (action === "reject") return { group: "failed", label: "처리 불가", tone: "danger", struck: false };
  if (hasActivePreview) return { group: "approval", label: "검토 대기", tone: "primary", struck: false };
  if (isApplied) return { group: "done", label: "저장됨", tone: "primary", struck: false };
  if (isRejected) return { group: "done", label: "거절됨", tone: "danger", struck: true };
  if (action === "markdown_edit" || action === "markdown_create") return { group: "done", label: "제안 완료", tone: "muted", struck: false };
  return { group: "done", label: "답변", tone: "muted", struck: false };
}

/** 서버 버전 기록으로 적용 여부를 확인할 편집 작업(새로 고침 뒤에도 "저장됨"을 지키려고). */
export function isServerAppliableTask(item: Pick<TaskMessageItem, "action" | "messageStatus" | "turnId">): boolean {
  return item.action === "markdown_edit" && item.messageStatus === "completed" && Boolean(item.turnId);
}

export type TaskApplyTarget = { turnId: string; documentId: string | null; applyOperationId: string | null };

/**
 * 편집안이 실제 문서에 저장된 turn ID. Agent 적용으로 저장한 버전은 operation_id에 turn의 apply_operation_id를 남긴다
 * (document 버전 목록). 버전 목록을 아직 못 받은 문서는 판단하지 않는다.
 */
export function collectServerAppliedTurnIds(
  targets: TaskApplyTarget[],
  versionsByDocument: ReadonlyMap<string, ReadonlyArray<{ operation_id?: string | null }>>
): Set<string> {
  const applied = new Set<string>();
  for (const { turnId, documentId, applyOperationId } of targets) {
    if (!documentId || !applyOperationId) continue;
    if (versionsByDocument.get(documentId)?.some((version) => version.operation_id === applyOperationId)) applied.add(turnId);
  }
  return applied;
}

/** 상태별 묶음으로 나눈다. 묶음 안은 보낸 순서를 지킨다. 빈 묶음은 뺀다. */
export function groupTaskEntries<T extends { status: TaskStatusView }>(entries: T[]) {
  return TASK_GROUPS
    .map(({ group, label }) => ({ group, label, entries: entries.filter((entry) => entry.status.group === group) }))
    .filter((section) => section.entries.length > 0);
}

/** 입력이 "/" 또는 "/검색어"뿐일 때 스킬 고르기를 연다(Figma 1627:9886). 그 밖에는 null. */
export function parseSkillSlashQuery(value: string): string | null {
  const match = value.match(/^\/([^\s/]*)$/);
  return match ? match[1].toLowerCase() : null;
}

export type SkillPickerItem = { id: string; slug: string; description: string };
export type SkillPickerGroup = { kind: "document" | "folder"; label: string; items: SkillPickerItem[] };

/** 사용 중인 스킬을 문서·폴더 정리 두 묶음으로 나누고 slug·설명으로 거른다. */
export function buildSkillPickerGroups(skills: SkillResponse[], query: string): SkillPickerGroup[] {
  const needle = query.trim().toLowerCase();
  const groups: SkillPickerGroup[] = [
    { kind: "document", label: "문서", items: [] },
    { kind: "folder", label: "폴더 정리", items: [] }
  ];
  for (const skill of skills) {
    const version = skill.enabled_version;
    if (skill.status !== "enabled" || !version) continue;
    const description = version.description.trim().normalize("NFC");
    if (needle && !skill.slug.toLowerCase().includes(needle) && !description.toLowerCase().includes(needle)) continue;
    const kind = version.capabilities.includes("folder-organize") ? "folder" : "document";
    groups.find((group) => group.kind === kind)?.items.push({ id: skill.id, slug: skill.slug, description });
  }
  return groups.filter((group) => group.items.length > 0);
}

/**
 * 입력창 전송 경로. 채팅 탭은 문서가 열려 있어도 항상 위키 질의(query)이고,
 * 작업 탭은 문서가 없어도 항상 agent turn(task)이다. 보낼 내용이 없으면 null.
 */
export function resolveSubmitRoute(view: "chat" | "work", question: string): "query" | "task" | null {
  const text = question.trim();
  if (!text) return null;
  if (view === "chat") return "query";
  return text === "/" ? null : "task";
}

/**
 * 스킬 만들기·상세 시트가 열리고 닫힐 때의 패널 탭(Figma 1671:13573 · 1708:3848).
 * 열리면 테스트 실행 묶음이 있는 작업 탭으로 옮기고 원래 탭을 기억해 두었다가, 닫히면 그 탭으로 돌려놓는다.
 */
export function skillSheetPanelView(
  isSheetOpen: boolean,
  current: "chat" | "work",
  saved: "chat" | "work" | null
): { view: "chat" | "work"; saved: "chat" | "work" | null } {
  if (isSheetOpen) return { view: "work", saved: saved ?? current };
  return { view: saved ?? current, saved: null };
}

/** 선택 칩 문구(Figma 1627:9923 "선택 : 연구 개요 문단"). 선택한 첫 줄을 짧게 줄인다. */
export function selectionChipLabel(markdown: string, startLine: number, endLine: number, maxLength = 12): string {
  const lines = markdown.split("\n").slice(Math.max(0, startLine - 1), Math.max(startLine, endLine));
  const text = lines.map((line) => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*)/, "").trim()).find(Boolean) ?? "";
  const short = text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  return short ? `선택 : ${short}` : `선택 : ${startLine}~${endLine}줄`;
}

/**
 * 작업 카드 머리글(Figma 1671:13225 "문서 : /research-summary")과 따옴표 안 요청 문장. "/slug 요청"이면 둘로 나눈다.
 * 폴더 정리도 스킬로 실행했으면 Figma 1656:11824·1656:11856처럼 "문서 : /file-organize"로 쓴다.
 */
export function describeTaskRequest(action: string | null, request: string): { heading: string; quote: string } {
  const kind = taskKindLabel(action);
  const match = request.match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/);
  if (!match) return { heading: kind, quote: request };
  const skillKind = action === "folder_organize" ? "문서" : kind;
  return { heading: `${skillKind} : /${match[1]}`, quote: match[2]?.trim() || `/${match[1]}` };
}
