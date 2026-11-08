import type { ChatMessageReferenceResponse, ChatMessageResponse } from "@/entities/chat/model/chat";
import type { SkillResponse } from "@/entities/skill/model/skill";
import type { AgentChatTranslator } from "@/features/agent-chat/lib/agentChatTranslator";
import { agentPlanStatusLabel, isWorkspacePlanAction, shouldPollAgentPlan } from "@/features/agent-chat/lib/agentPlan";
import type { ReadOnlyRequests } from "@/features/agent-chat/lib/readOnlyRequests";
import { isTurnCancelling, type TurnCancelState } from "@/features/agent-chat/lib/stalledTurns";

/**
 * 채팅 탭과 작업 탭의 분리(2026-10-19 계약).
 * 채팅 탭은 위키 질의(Query) 문답만, 작업 탭은 문서 편집·폴더 정리·스킬 실행(agent turn) 문답만 보여 준다.
 * 둘은 같은 채팅 세션 메시지를 나눠 쓴다. 서버는 질의 메시지에 action 키를 빼고, agent turn 메시지에만 action을 넣는다.
 */

/** 채팅 답변으로 남는 agent 갈래. 작업 탭이 생기기 전 문서를 연 채 질문해 agent가 답한 기록이다. */
const CHAT_ANSWER_ACTIONS = new Set(["chat_answer", "conversation_reply"]);
/** agent turn run ID 접두사(document AgentTurnService). 질의 run은 query_로 시작한다. */
const AGENT_RUN_PREFIX = "agent_";

function isAgentTurnMessage(message: ChatMessageResponse): boolean {
  return Boolean(message.run_id?.startsWith(AGENT_RUN_PREFIX)) || (Boolean(message.action) && !CHAT_ANSWER_ACTIONS.has(message.action ?? ""));
}

/**
 * 작업 탭에 둘 메시지인지. taskRunIds는 이 화면에서 작업 탭으로 보낸 turn ID다.
 * mode=task를 아직 모르는 서버가 채팅 답변(chat_answer)으로 돌려줘도 보낸 탭(작업)에 남긴다.
 */
export function isTaskMessage(message: ChatMessageResponse, taskRunIds: ReadonlySet<string> = new Set()): boolean {
  if (message.run_id && taskRunIds.has(message.run_id)) return true;
  if (message.action) return !CHAT_ANSWER_ACTIONS.has(message.action);
  // action이 없는 agent turn 메시지(진행 중·취소·실패로 끝남)도 상태와 상관없이 작업 탭에 둔다. 실패는 '실패' 묶음에 보인다.
  return Boolean(message.run_id?.startsWith(AGENT_RUN_PREFIX));
}

/**
 * 메시지만 보고 세션이 어느 탭의 것인지 정한다. 탭 구분이 없는 새 브라우저에서 쓴다.
 * 사용자 메시지에는 run_id·action이 없으므로 문답(pair) 단위로 짝이 되는 답변을 본다.
 * 채팅 탭은 질의만 보내므로 agent turn의 채팅 답변(chat_answer 등)도 작업 근거로 센다. 질의와 섞인 세션만 이전 통합 대화다.
 * 짝을 알 수 없거나 답변이 없는 사용자 메시지는 근거로 삼지 않는다.
 */
export function classifySessionChannel(messages: readonly ChatMessageResponse[]): "chat" | "work" | "legacy" {
  const isChatEvidence = (message: ChatMessageResponse) => message.role === "assistant" && !isAgentTurnMessage(message);
  const agentPairIds = new Set(messages.flatMap((message) => (message.pair_id && isAgentTurnMessage(message) ? [message.pair_id] : [])));
  const hasWork = messages.some(isAgentTurnMessage);
  const hasChat = messages.some((message) => isChatEvidence(message) && !(message.pair_id && agentPairIds.has(message.pair_id)));
  if (hasWork) return hasChat ? "legacy" : "work";
  return "chat";
}

export type TaskMessageItem = {
  key: string;
  pairId: string | null;
  /** 이 작업을 만든 agent turn ID. 폴더 정리 계획은 이 ID로 run을 찾는다. */
  turnId: string | null;
  action: string | null;
  /** AI가 되물은 이유 코드(chat.md clarify_reason). 없으면 null */
  clarifyReason: string | null;
  /** 요청 때 보기 권한만 있다고 서버가 확인한 열린 문서(chat.md read_only_document_id). 없으면 null */
  readOnlyDocumentId: string | null;
  /** 사용자가 보낸 원래 요청 */
  request: string;
  /** AI가 남긴 답(편집 요약·되묻는 질문 등) */
  answer: string;
  /** 답변의 근거(chat.md references). 대화형 답변의 인용 번호가 이 문서를 연다. */
  references: ChatMessageReferenceResponse[];
  messageStatus: string;
  /** 요청을 보낸 시각(ISO). 작업 카드의 "방금 전"에 쓴다. */
  createdAt: string | null;
};

/** 작업 카드에 보일 AI의 답. 실패로 끝난 turn은 서버 안내 문구(error_message)를 먼저 쓴다. */
function taskAnswer(assistant: ChatMessageResponse | undefined): string {
  if (!assistant) return "";
  if (assistant.status === "failed" && assistant.error_message?.trim()) return assistant.error_message;
  return assistant.content ?? "";
}

function toTaskItem(key: string, pairId: string | null, messages: ChatMessageResponse[]): TaskMessageItem {
  const user = messages.find((message) => message.role === "user");
  const assistant = messages.findLast((message) => message.role === "assistant");
  return {
    key,
    pairId,
    turnId: assistant?.run_id ?? user?.run_id ?? null,
    action: assistant?.action ?? null,
    clarifyReason: assistant?.clarify_reason ?? null,
    readOnlyDocumentId: assistant?.read_only_document_id ?? null,
    request: (user?.content ?? "").trim().normalize("NFC"),
    answer: taskAnswer(assistant).trim().normalize("NFC"),
    references: assistant?.references ?? [],
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

/** 첨부를 다 읽지 못했다는 안내의 시작(ai reference_document_notice). 영어로 요청하면 영어 문장으로 온다. */
const REFERENCE_NOTICE_PATTERN = /^(?:첨부한 문서(가 길어 앞부분만| 중 \d+개는 너무 길어)|\d+ of the attached documents were too long|The attached document is long, so I only read the beginning)/;

/**
 * 편집 결과 메시지에서 첨부를 다 읽지 못했다는 안내 문단만 꺼낸다. 메시지 나머지는 요약과 "아직 적용하지 않았어요"처럼
 * 제안 화면이 이미 보여 주는 내용이다. 안내는 코드 없이 문장으로만 오므로 ai 문구에 기댄다. 없으면 null이다.
 */
export function editResultNotice(message: string | null | undefined): string | null {
  const notices = (message ?? "").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter((paragraph) => REFERENCE_NOTICE_PATTERN.test(paragraph));
  return notices.join("\n") || null;
}

/** 작업 종류(Figma 1610:9600 "문서 : …"의 앞부분). */
export function taskKindLabel(action: string | null, t: AgentChatTranslator): string {
  switch (action) {
    case "folder_organize": return t("task.kind.folderOrganize");
    case "folder_lookup": return t("task.kind.folderLookup");
    case "workspace_workflow": return t("task.kind.workspace");
    case "markdown_edit":
    case "markdown_create": return t("task.kind.document");
    case "skill_authoring":
    case "skill_draft_proposal": return t("task.kind.skill");
    default: return t("task.kind.task");
  }
}

const SLASH_COMMAND_PATTERN = /^\/([a-z0-9][a-z0-9-]{0,62})(?:\s|$)/;

/** '상황에 맞게' 스킬의 되묻기("새 문서로 만들까요, 지금 문서를 수정할까요?")에 답하는 두 선택. 버튼 문구와 보낼 요청은 agentChat.task.skillMode.{id}에 있다. */
export const SKILL_MODE_CHOICES = [
  { id: "create", createsDocument: true },
  { id: "edit", createsDocument: false }
] as const;

/** 되묻기 문장의 새 문서·수정 단어. 영어로 요청하면 영어 문장으로 온다(ai CLARIFY_SKILL_RESULT_MODE_MESSAGE). */
const SKILL_MODE_QUESTION_WORDS: readonly (readonly [RegExp, RegExp])[] = [[/새 문서/, /수정/], [/new document/i, /\bedit\b/i]];

/**
 * 스킬(`/slug …`)로 보낸 작업에 AI가 새 문서·문서 수정 중 무엇을 할지 되물었으면 그 slug, 아니면 null.
 * 답도 `/slug 새 문서로 만들어 줘`처럼 커맨드를 붙여 보내야 스킬이 유지된다(ai agent.md).
 */
export function skillModeQuestionSlug(item: Pick<TaskMessageItem, "action" | "request" | "answer">): string | null {
  if (item.action !== "clarify") return null;
  const match = SLASH_COMMAND_PATTERN.exec(item.request);
  if (!match) return null;
  return SKILL_MODE_QUESTION_WORDS.some(([create, edit]) => create.test(item.answer) && edit.test(item.answer)) ? match[1] : null;
}

/** AI가 편집 문맥 없는 수정 요청에 되묻는 이유 코드(ai agent.md clarify_reason). */
const MARKDOWN_DOCUMENT_REQUIRED = "markdown_document_required";
/**
 * 그 되묻기의 문장(ai handle_agent_turn CLARIFY_MARKDOWN_DOCUMENT_MESSAGE, 영어 요청이면 영어 문장). 코드가 없는 과거 메시지·배포 전 서버를 판단할 때만 쓴다.
 */
const OPEN_DOCUMENT_CLARIFICATIONS = ["수정할 Markdown 문서를 연 뒤 다시 요청해 주세요.", "Open the Markdown document to edit, then try again."];
/** 첨부한 문서를 고치려 할 때의 되묻기 문장에 든 말(ai handle_agent_turn CLARIFY_REFERENCE_EDIT_MESSAGE, 영어 요청이면 영어 문장). */
const ATTACHED_DOCUMENT_CLARIFICATION_MARK = /첨부한 문서|attached document/i;

/** 문서가 필요해 되물었는지. 코드가 있으면 코드만 보고(모르는 코드는 다른 이유), 코드가 없을 때만 문장으로 판단한다. */
function asksForMarkdownDocument(item: Pick<TaskMessageItem, "clarifyReason" | "answer">): boolean {
  // 첨부한 문서를 고치려 한 되묻기도 같은 코드로 온다. 첨부 문서 이야기라 열린 문서의 보기 권한 안내로 바꾸지 않는다.
  if (ATTACHED_DOCUMENT_CLARIFICATION_MARK.test(item.answer)) return false;
  if (item.clarifyReason !== null) return item.clarifyReason === MARKDOWN_DOCUMENT_REQUIRED;
  return OPEN_DOCUMENT_CLARIFICATIONS.includes(item.answer.trim().normalize("NFC"));
}

/**
 * 보기 권한 문서는 편집기를 열지 않아 편집 문맥 없이 요청이 나가고, AI는 문서를 열라고 되묻는다. 문서를 연 사용자에게 맞지 않으니
 * 그 문서를 연 채 보낸 요청의 되묻기만, 그 문서가 열려 있는 동안 이유를 알려 주는 문장으로 바꾼다. 문서 없이 받은 되묻기는 그대로 둔다.
 * 이유 코드는 편집 문맥이 없었다는 뜻뿐이고 문서를 안 연 요청에도 같은 값이 오므로, 어느 문서에서 보냈는지는 메시지의 서버 값으로 가린다.
 * 서버 값이 없는 메시지(구 서버·과거 메시지)만 이 브라우저의 readOnlyRequests로 판단한다. 서버 값이 있으면 그 값만 따른다.
 */
export function withReadOnlyDocumentClarification<T extends Pick<TaskMessageItem, "turnId" | "action" | "clarifyReason" | "readOnlyDocumentId" | "answer">>(
  items: T[],
  readOnlyDocumentId: string | null,
  readOnlyRequests: ReadOnlyRequests,
  t: AgentChatTranslator
): T[] {
  if (!readOnlyDocumentId) return items;
  return items.map((item) => (
    item.action === "clarify"
    && (item.readOnlyDocumentId ?? (item.turnId !== null ? readOnlyRequests.get(item.turnId) : undefined)) === readOnlyDocumentId
    && asksForMarkdownDocument(item)
      ? { ...item, answer: t("task.readOnlyClarification") }
      : item
  ));
}

/** 첨부 중 어느 문서를 고칠지 몰라 되물은 이유 코드(ai ClarifyReason). */
const ATTACHMENT_TARGET_REQUIRED = "attachment_target_required";

/** 이 turn이 고칠 첨부를 못 정해 되물었는지. 답을 보낼 때 같은 첨부가 함께 가도록 입력창에 칩을 남긴다. */
export function isAttachmentTargetClarification(items: ReadonlyArray<Pick<TaskMessageItem, "turnId" | "action" | "clarifyReason">>, turnId: string | null): boolean {
  if (!turnId) return false;
  return items.some((item) => item.turnId === turnId && item.action === "clarify" && item.clarifyReason === ATTACHMENT_TARGET_REQUIRED);
}

/** 입력이 `/slug` 또는 `/slug 요청`으로 시작하면 그 slug, 아니면 null. */
export function slashCommandSlug(text: string): string | null {
  return SLASH_COMMAND_PATTERN.exec(text.trim())?.[1] ?? null;
}

/** 되묻기 선택 → 작업 탭으로 보낼 요청 문장 */
export function skillModeAnswer(slug: string, choice: (typeof SKILL_MODE_CHOICES)[number], t: AgentChatTranslator): string {
  return `/${slug} ${t(`task.skillMode.${choice.id}.request`)}`;
}

export type TaskGroup = "running" | "approval" | "clarify" | "partial_failed" | "failed" | "done";

/** Figma 1671:13216처럼 상태별 묶음으로 보여 준다(확인 필요·선택 필요·완료). 할 일이 남은 묶음을 위에 둔다. 묶음 이름은 agentChat.task.group.{group}이다. */
export const TASK_GROUPS: readonly TaskGroup[] = ["running", "approval", "clarify", "partial_failed", "failed", "done"];

export type TaskStatusView = {
  group: TaskGroup;
  label: string;
  /** primary: 파란 글자, danger: 빨간 글자(취소선은 struck) */
  tone: "primary" | "danger" | "muted";
  struck: boolean;
};

const FAILED_RUN_STATUSES = new Set(["failed", "partial_failed", "conflicted", "rollback_failed"]);

/**
 * 취소한 turn의 상태. 서버는 말풍선을 바로 cancelled로 닫지만 turn은 되돌리기를 마쳐야 끝나므로,
 * turn 조회로 받은 진행 상태(cancelState)를 따른다. 아직 모르면 "취소됨"으로 둔다.
 */
function cancelledTaskStatus(cancelState: TurnCancelState | null, t: AgentChatTranslator): TaskStatusView {
  if (isTurnCancelling(cancelState)) return { group: "running", label: t("stalled.cancellingLabel"), tone: "muted", struck: false };
  if (cancelState === "rollback_failed") return { group: "failed", label: t("stalled.rollbackFailedLabel"), tone: "danger", struck: false };
  if (cancelState === "rollback_partial") return { group: "failed", label: t("stalled.rollbackPartialLabel"), tone: "danger", struck: false };
  return { group: "done", label: t("task.status.cancelled"), tone: "muted", struck: true };
}

export function resolveTaskStatus({
  action,
  messageStatus,
  runStatus,
  operationCount = 0,
  excludedCount = 0,
  createdFolderCount = 0,
  hasActivePreview = false,
  isProposalHeld = false,
  isProposalSetAside = false,
  isDocumentPurged = false,
  isApplied = false,
  isRejected = false,
  isCancelled = false,
  hasLaterTask = false,
  isSuperseded = false,
  isStalled = false,
  isReleased = false,
  isCancelAccepted = false,
  cancelState = null,
  isPlanSuperseded = false
}: {
  action: string | null;
  messageStatus: string;
  /** 폴더 정리 계획 run 상태. 아직 받지 못했으면 undefined */
  runStatus?: string;
  /** 실행 완료된 계획에서 실제로 저장된 작업 수(summarizePlanOperationResults.applied) */
  operationCount?: number;
  /** 고르지 않았거나 건너뛰어 저장하지 않은 작업 수 */
  excludedCount?: number;
  /** 실행으로 만들어진 새 폴더 수. 폴더 정리는 저장·제외를 줄(문서) 단위로 세고 새 폴더는 따로 적는다. */
  createdFolderCount?: number;
  /** 이 화면에서 받은 편집안·새 문서 초안을 아직 검토하는 중인지 */
  hasActivePreview?: boolean;
  /** 이 turn의 응답이 아직 화면에 있거나(자동 적용을 처리하는 중 등) 저장 여부를 확인하지 못했는지(조회 중·조회 실패). 아직 수락하지 않았다고 단정할 수 없다. */
  isProposalHeld?: boolean;
  /** 후속 요청에 자리를 내줘 내려 둔 제안인지. 다시 열어 결정할 수 있다. */
  isProposalSetAside?: boolean;
  /** 대상 문서가 영구 삭제돼 편집안이 지워진 turn인지 */
  isDocumentPurged?: boolean;
  /** 편집안을 적용·새 문서로 만들었는지(이 화면의 기록 또는 서버 버전 기록) */
  isApplied?: boolean;
  /** 편집안을 모두 거절했는지 */
  isRejected?: boolean;
  /** 편집안·새 문서 초안을 적용하지 않고 취소했는지 */
  isCancelled?: boolean;
  /** 이 작업 뒤에 보낸 작업이 있는지. 되물음은 다음 요청으로 답했거나 지나간 것으로 본다. */
  hasLaterTask?: boolean;
  /** 같은 요청·스킬을 같은 대상에 뒤에 다시 실행해 끝났는지(supersededTaskKeys). 남은 되물음은 더 답할 필요가 없다. */
  isSuperseded?: boolean;
  /** pending에 오래 머물러 응답을 받지 못한 turn(stalledTurns) */
  isStalled?: boolean;
  /** 응답을 받지 못한 turn을 사용자가 닫았는지 */
  isReleased?: boolean;
  /** 닫기·중지로 보낸 취소를 서버가 받아들였는지(취소 계열 응답). 목록이 아직 pending이어도 "취소됨"으로 본다. */
  isCancelAccepted?: boolean;
  /** 취소한 turn을 조회해 받은 취소 진행 상태(취소하는 중·취소됨·복구 실패). 모르면 null */
  cancelState?: TurnCancelState | null;
  /** 같은 대상 폴더에 뒤에 실행한 새 계획이 승인 대기에 도달해 이 승인 대기 계획을 대신했는지(거절해 정리한다) */
  isPlanSuperseded?: boolean;
}, t: AgentChatTranslator): TaskStatusView {
  if (messageStatus === "pending") {
    if (isCancelAccepted) return cancelledTaskStatus(cancelState, t);
    if (isReleased) return { group: "done", label: t("task.status.released"), tone: "muted", struck: true };
    if (isStalled) return { group: "failed", label: t("stalled.turnTitle"), tone: "danger", struck: false };
    return { group: "running", label: t("task.status.running"), tone: "primary", struck: false };
  }
  if (messageStatus === "failed") return { group: "failed", label: t("task.status.failed"), tone: "danger", struck: true };
  // 진행 중에 취소돼 서버가 닫은 turn(agent turn 취소 API). 편집안 초안을 취소한 것과 같은 "취소됨"으로 보인다.
  if (messageStatus === "cancelled") return cancelledTaskStatus(cancelState, t);
  if (isWorkspacePlanAction(action ?? undefined)) {
    if (!runStatus) return { group: "running", label: agentPlanStatusLabel(undefined, t), tone: "muted", struck: false };
    if (isPlanSuperseded && (runStatus === "awaiting_approval" || runStatus === "rejected")) {
      return { group: "done", label: t("task.status.superseded"), tone: "muted", struck: false };
    }
    if (runStatus === "awaiting_approval") return { group: "approval", label: t("plan.status.awaiting_approval"), tone: "primary", struck: false };
    if (runStatus === "clarification_required") {
      return isSuperseded
        ? { group: "done", label: t("task.status.rerun"), tone: "muted", struck: false }
        : { group: "clarify", label: t("plan.status.clarification_required"), tone: "primary", struck: false };
    }
    if (runStatus === "completed") {
      const label = [
        t("task.status.savedCount", { count: operationCount }),
        excludedCount > 0 && t("task.status.excludedCount", { count: excludedCount }),
        createdFolderCount > 0 && t("task.status.newFolderCount", { count: createdFolderCount })
      ].filter(Boolean).join(" · ");
      return { group: "done", label, tone: "primary", struck: false };
    }
    if (runStatus === "rejected") return { group: "done", label: t("task.status.rejected"), tone: "danger", struck: true };
    if (runStatus === "cancelled") return { group: "done", label: t("task.status.cancelled"), tone: "danger", struck: true };
    // 일부는 저장됐으므로 전부 실패처럼 묶거나 취소선을 긋지 않는다.
    if (runStatus === "partial_failed") return { group: "partial_failed", label: agentPlanStatusLabel(runStatus, t), tone: "danger", struck: false };
    if (FAILED_RUN_STATUSES.has(runStatus)) return { group: "failed", label: agentPlanStatusLabel(runStatus, t), tone: "danger", struck: true };
    if (shouldPollAgentPlan(runStatus)) return { group: "running", label: agentPlanStatusLabel(runStatus, t), tone: "primary", struck: false };
    return { group: "done", label: agentPlanStatusLabel(runStatus, t), tone: "muted", struck: false };
  }
  if (action === "clarify") {
    return hasLaterTask
      ? { group: "done", label: t("task.status.pastQuestion"), tone: "muted", struck: false }
      : { group: "clarify", label: t("task.status.needsAnswer"), tone: "primary", struck: false };
  }
  if (action === "reject") return { group: "failed", label: t("task.status.unprocessable"), tone: "danger", struck: false };
  if (hasActivePreview) return { group: "approval", label: t("task.status.awaitingReview"), tone: "primary", struck: false };
  if (isApplied) return { group: "done", label: t("task.status.saved"), tone: "primary", struck: false };
  if (isRejected) return { group: "done", label: t("task.status.rejected"), tone: "danger", struck: true };
  if (isCancelled) return { group: "done", label: t("task.status.cancelled"), tone: "muted", struck: true };
  if (action === "markdown_edit" || action === "markdown_create") {
    if (isProposalSetAside) return { group: "approval", label: t("task.status.awaitingReview"), tone: "primary", struck: false };
    if (isDocumentPurged) return { group: "done", label: t("task.status.documentPurged"), tone: "muted", struck: false };
    // 수락하지 않았다고 적는 것은 서버 버전 기록까지 확인한 편집뿐이다. 새 문서 초안은 서버로 확인할 수 없어 다른 브라우저에서 수락했을 수 있다.
    const isUnconfirmed = isProposalHeld || action === "markdown_create";
    return { group: "done", label: isUnconfirmed ? t("task.status.proposed") : t("task.status.notAccepted"), tone: "muted", struck: false };
  }
  return { group: "done", label: t("task.status.answered"), tone: "muted", struck: false };
}

/** 자동 승인으로 실행한 계획은 상태 뒤에 "자동 승인됨"(agentChat.task.status.autoApproved)을 붙여 직접 승인한 작업과 구별한다. */
export function withAutoApprovalLabel(status: TaskStatusView, isAutoApproved: boolean, t: AgentChatTranslator): TaskStatusView {
  if (!isAutoApproved || status.group === "approval") return status;
  return { ...status, label: `${status.label} · ${t("task.status.autoApproved")}` };
}

/** 같은 작업을 다시 실행한 것으로 볼 기준: 스킬 요청은 `/slug`, 그 밖에는 요청 문장 그대로. */
function taskRequestKey(request: string): string {
  const text = request.trim().normalize("NFC");
  const slug = slashCommandSlug(text);
  return slug ? `/${slug}` : text;
}

/**
 * 뒤에 같은 요청·스킬을 같은 대상에 다시 보내 끝난(completed) 작업의 key. 그 앞의 되물음("추가 설명 필요")은
 * 다시 실행으로 지나갔으므로 "선택 필요"에 남기지 않는다. 뒤 작업이 아직 진행 중이거나 실패했으면 그대로 둔다.
 * targetOf: 작업 대상(폴더 정리 run의 target_folder_id 등). 다른 폴더에 같은 스킬을 실행한 것은 다시 실행이 아니므로,
 * 대상을 모르는 작업은 대신하지도 대신받지도 않는다.
 */
export function supersededTaskKeys<T extends Pick<TaskMessageItem, "key" | "request" | "messageStatus">>(
  items: ReadonlyArray<T>,
  targetOf: (item: T) => string | null | undefined
): Set<string> {
  const superseded = new Set<string>();
  const completedLater = new Set<string>();
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const requestKey = taskRequestKey(item.request);
    const target = targetOf(item);
    if (!requestKey || !target) continue;
    const key = JSON.stringify([requestKey, target]);
    if (completedLater.has(key)) superseded.add(item.key);
    if (item.messageStatus === "completed") completedLater.add(key);
  }
  return superseded;
}

/** 완료 묶음에서 한 줄 대신 답을 카드로 보일 작업. 폴더 내용 조회와 대화형 답변(첨부 문서를 근거로 한 답 등)은 답이 곧 결과다. */
export function isAnswerTask(item: Pick<TaskMessageItem, "action" | "messageStatus" | "answer">): boolean {
  const isAnswerAction = item.action === "product_help" || item.action === "folder_lookup" || (item.action !== null && CHAT_ANSWER_ACTIONS.has(item.action));
  return isAnswerAction && item.messageStatus === "completed" && item.answer !== "";
}

/** 서버 버전 기록으로 적용 여부를 확인할 편집 작업(새로 고침 뒤에도 "저장됨"을 지키려고). */
export function isServerAppliableTask(item: Pick<TaskMessageItem, "action" | "messageStatus" | "turnId">): boolean {
  return item.action === "markdown_edit" && item.messageStatus === "completed" && Boolean(item.turnId);
}

export type TaskApplyTarget = { turnId: string; documentId: string | null; applyOperationId: string | null };

type ApplyCheckQuery = { isPending: boolean; isError: boolean };

/**
 * 서버 기록으로 저장 여부를 가리지 못한 편집 작업인지. 조회 중·조회 실패이거나, 버전과 맞춰 볼 대상 문서·적용 ID가 없으면 그렇다.
 * versions는 그 문서의 버전 목록 조회다. 영구 삭제된 문서는 버전 목록이 없고 저장 여부와 상관없이 삭제됨으로 보인다.
 */
export function isApplyCheckUnresolved(
  turn: ApplyCheckQuery & { data?: Omit<TaskApplyTarget, "turnId"> & { isPurged: boolean } },
  versions: ApplyCheckQuery | undefined
): boolean {
  if (turn.isPending || turn.isError) return true;
  if (turn.data?.isPurged) return false;
  return !turn.data?.documentId || !turn.data.applyOperationId || !versions || versions.isPending || versions.isError;
}

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
export function groupTaskEntries<T extends { status: TaskStatusView }>(entries: T[], t: AgentChatTranslator) {
  return TASK_GROUPS
    .map((group) => ({ group, label: t(`task.group.${group}`), entries: entries.filter((entry) => entry.status.group === group) }))
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
export function buildSkillPickerGroups(skills: SkillResponse[], query: string, t: AgentChatTranslator): SkillPickerGroup[] {
  const needle = query.trim().toLowerCase();
  const groups: SkillPickerGroup[] = [
    { kind: "document", label: t("task.kind.document"), items: [] },
    { kind: "folder", label: t("task.kind.folderOrganize"), items: [] }
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
export function selectionChipLabel(markdown: string, startLine: number, endLine: number, t: AgentChatTranslator, maxLength = 12): string {
  const lines = markdown.split("\n").slice(Math.max(0, startLine - 1), Math.max(startLine, endLine));
  const text = lines.map((line) => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*)/, "").trim()).find(Boolean) ?? "";
  const short = text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  return short ? t("task.selectionChip.text", { text: short }) : t("task.selectionChip.lines", { start: startLine, end: endLine });
}

/**
 * 작업 카드에 쓸 요청 문장. 사용자가 보낸 요청(itemRequest)과 run이 정리한 요약(request_summary)을 고른다.
 * 스킬로 실행한 요청("/slug …")은 AI가 요약을 문장으로 다시 써도("'slug' Skill의 지침에 따라 …") 머리글이
 * "문서 : /slug"로 남도록 사용자가 보낸 원문을 쓰고, 요약은 summary로 따로 돌려준다.
 * 그 밖의 요청은 지금처럼 요약을 먼저 쓴다.
 */
export function resolveTaskRequest(
  itemRequest: string | null | undefined,
  runSummary: string | null | undefined,
  t: AgentChatTranslator
): { request: string; summary: string | null } {
  const original = (itemRequest ?? "").trim();
  const summary = runSummary?.trim().normalize("NFC") || null;
  if (original.startsWith("/")) return { request: original, summary: summary === original ? null : summary };
  return { request: summary || original || t("task.emptyRequest"), summary: null };
}

/**
 * 작업 카드 머리글(Figma 1671:13225 "문서 : /research-summary")과 따옴표 안 요청 문장. "/slug 요청"이면 둘로 나눈다.
 * 폴더 정리도 스킬로 실행했으면 Figma 1656:11824·1656:11856처럼 "문서 : /file-organize"로 쓴다.
 */
export function describeTaskRequest(action: string | null, request: string, t: AgentChatTranslator): { heading: string; quote: string } {
  const kind = taskHeadingKind(action, request, t);
  const match = request.match(SKILL_REQUEST_PATTERN);
  if (!match) return { heading: kind, quote: request };
  return { heading: `${kind} : /${match[1]}`, quote: match[2]?.trim() || `/${match[1]}` };
}

const SKILL_REQUEST_PATTERN = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/;

/**
 * 작업 카드 머리글·완료 행 앞의 종류. `/slug` 스킬 실행은 결과 action이 정해지기 전(진행 중)과 뒤(완료·되묻기·실패)가
 * 같도록 늘 "문서"로 적는다(Figma 1571:27625 "문서 : /file-organize"). 스킬이 아닌 요청은 action별 라벨을 쓴다.
 */
export function taskHeadingKind(action: string | null, request: string, t: AgentChatTranslator): string {
  return SKILL_REQUEST_PATTERN.test(request.trim()) ? t("task.kind.document") : taskKindLabel(action, t);
}
