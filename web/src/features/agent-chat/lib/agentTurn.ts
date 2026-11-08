import type { ActiveMarkdownEditContext, MarkdownEditorSnapshot } from "./markdownEditContext";
import type { AiModelSelection } from "@/entities/ai";
import { lineDiff, type MarkdownDiffLine } from "@/shared/lib/lineDiff";
import type { AgentChatTranslator } from "./agentChatTranslator";

/** 작업 탭 요청 표시. 서버는 이 값이 있으면 문서 없이도 받고 채팅 답변 갈래를 고르지 않는다(document·ai 계약). */
export const AGENT_TURN_TASK_MODE = "task";

export type AgentTurnRequest = {
  session_id: string;
  message: string;
  provider: string;
  model: string;
  allow_web_search: boolean;
  mode: typeof AGENT_TURN_TASK_MODE;
  conversationContext?: { selected_pair_ids: string[] };
  /** 작업 대상 폴더(폴더 정리 범위·새 문서 위치). 생략하면 루트·워크스페이스 전체(document AgentTurnRequest 계약). */
  folder_id?: string;
  /** 보기 권한 문서를 연 채 보낸 요청의 그 문서. 서버가 확인해 메시지에 남긴다. 편집 대상이 아니며 틀린 값은 서버가 무시한다(document AgentTurnRequest 계약). */
  read_only_document_id?: string;
  /** 근거로 첨부한 문서(최대 3개). 편집 대상이 아니며 없으면 생략한다. 쓸 수 없는 문서가 있으면 서버가 400을 준다(document AgentTurnRequest 계약). */
  reference_document_ids?: string[];
} & (
  // 문서를 열지 않았거나 작업 대상에서 뺐으면 세 필드를 함께 생략한다(document AgentTurnRequest 계약).
  | { documentId: string; baseVersion: number; editorSnapshot: MarkdownEditorSnapshot }
  | { documentId?: undefined; baseVersion?: undefined; editorSnapshot?: undefined }
);

/** 문서를 대상으로 보낸 요청. 편집안 검토·적용은 이 요청에만 할 수 있다. */
export type DocumentAgentTurnRequest = Extract<AgentTurnRequest, { documentId: string }>;

export function isDocumentAgentTurnRequest(request: AgentTurnRequest): request is DocumentAgentTurnRequest {
  return typeof request.documentId === "string" && request.editorSnapshot !== undefined;
}

type AgentTurnRequestContext = {
  sessionId: string;
  selectedModel: AiModelSelection;
  selectedPairIds: string[];
  allowWebSearch?: boolean;
  /** 폴더를 대상으로 고른 스킬 실행. 없으면 folder_id를 싣지 않는다. */
  folderId?: string | null;
  /** 지금 연 보기 권한 문서. 없으면 read_only_document_id를 싣지 않는다. */
  readOnlyDocumentId?: string | null;
  /** 근거로 첨부한 문서. 비어 있으면 reference_document_ids를 싣지 않는다. */
  referenceDocumentIds?: string[];
};

export type AgentTurnAction =
  | "chat_answer"
  | "conversation_reply"
  | "product_help"
  | "markdown_edit"
  | "markdown_create"
  | "clarify"
  | "reject"
  | "folder_organize"
  /** 작업 탭 폴더 내용 조회. 읽기 전용 답변이라 run·미리보기·승인이 없고 답은 message에만 온다(ai agent.md). */
  | "folder_lookup"
  | "workspace_workflow"
  | "skill_authoring"
  | "skill_draft_proposal";

export type DocumentCommandAction = Exclude<AgentTurnAction, "chat_answer" | "conversation_reply" | "product_help" | "clarify" | "reject" | "folder_lookup">;

export type AgentTurnEdit = {
  operation: "replace" | "insert_after";
  requested_target: {
    type: "selection" | "current_section" | "whole_document";
    start_line: number;
    end_line: number;
  };
  actual_target: {
    type: "selection" | "current_section" | "whole_document";
    start_line: number;
    end_line: number;
  };
  scope_expanded: boolean;
  changed: boolean;
  summary: string;
  replacement_markdown: string;
};

export type AgentTurnResult = {
  action: AgentTurnAction;
  route: {
    action: AgentTurnAction;
    confidence: number;
    reason: string;
    edit_goal: string | null;
    edit_operation: "replace" | "insert_after" | null;
    edit_destination: "target" | "document_end" | null;
  };
  message: string | null;
  chat: { answer: string } | null;
  edit: AgentTurnEdit | null;
  generated_markdown: {
    title: string;
    summary: string;
    markdown: string;
  } | null;
};

export type GeneratedMarkdownDraft = NonNullable<AgentTurnResult["generated_markdown"]>;

export type AgentTurnResponse = {
  documentId: string;
  baseVersion: number;
  requestId: string;
  apply_operation_id: string;
  /** 요청에 실은 작업 대상 폴더. 지정하지 않았으면 null. */
  folder_id?: string | null;
  status: "completed";
  result: AgentTurnResult;
};

/** 새 문서 초안(markdown_create)을 만들 폴더. turn에 지정한 대상 폴더를 쓰고, 없으면 루트(null)에 둔다. */
export function resolveGeneratedDocumentFolderId(response: Pick<AgentTurnResponse, "folder_id"> | null | undefined): string | null {
  return response?.folder_id ?? null;
}

/**
 * 새 문서 초안의 원문. 서버가 받은 편집 문서가 먼저이고, 보기 권한으로 연 문서는 첨부로 실어 보낸 요청일 때만 원문이다.
 * "현재 문서" 칩을 뺀 요청은 read_only_document_id가 있어도 그 문서를 쓰지 않았으므로 원문이 아니다.
 */
export function draftSourceDocumentId(
  response: { documentId: string | null },
  request: { read_only_document_id?: string | null; reference_document_ids?: readonly string[] } | null
): string | null {
  if (response.documentId) return response.documentId;
  const readOnlyDocumentId = request?.read_only_document_id;
  return readOnlyDocumentId && request?.reference_document_ids?.includes(readOnlyDocumentId) ? readOnlyDocumentId : null;
}

export type DraftPlacement = {
  folderId: string | null;
  /** 원문 옆으로 고른 폴더라 서버가 거절해도 기본 위치에 만들 수 있다. 사용자가 지정한 폴더는 옮기지 않는다. */
  canFallBackToRoot: boolean;
};

/**
 * 새 문서 초안을 둘 위치. turn에 지정한 대상 폴더가 먼저이고, 없으면 원문(열린 문서) 옆이다.
 * 문서를 열지 않고 만든 초안이나 쓸 수 없는 원문 폴더면 기본 위치(루트)다.
 */
export function resolveDraftPlacement({ targetFolderId, sourceFolderId, isFolderWriteDenied }: {
  targetFolderId: string | null;
  /** 원문이 있는 폴더. 루트면 null, 원문이 없거나 트리에서 못 찾으면 undefined */
  sourceFolderId: string | null | undefined;
  isFolderWriteDenied: (folderId: string) => boolean;
}): DraftPlacement {
  if (targetFolderId) return { folderId: targetFolderId, canFallBackToRoot: false };
  if (!sourceFolderId || isFolderWriteDenied(sourceFolderId)) return { folderId: null, canFallBackToRoot: false };
  return { folderId: sourceFolderId, canFallBackToRoot: true };
}

/** 트리가 오래돼 원문 폴더가 없어졌거나 권한이 바뀌었으면(403·404) 기본 위치에 다시 만든다. 그 밖의 실패는 그대로 던진다. */
export async function createInDraftPlacement<T>({ folderId, canFallBackToRoot }: DraftPlacement, create: (folderId: string | null) => Promise<T>): Promise<T> {
  try {
    return await create(folderId);
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (!canFallBackToRoot || (status !== 403 && status !== 404)) throw error;
    return create(null);
  }
}

export type { MarkdownDiffLine } from "@/shared/lib/lineDiff";

export type MarkdownEditPreview = {
  operation: AgentTurnEdit["operation"];
  summary: string;
  replacementMarkdown: string;
  nextMarkdown: string;
  diffLines: MarkdownDiffLine[];
};

type ChatTurnPresentation =
  | { kind: "query"; grounded: boolean }
  | { kind: "document-command"; action: DocumentCommandAction };

export function isDocumentCommandAction(action: string | undefined): action is DocumentCommandAction {
  return action === "markdown_edit"
    || action === "markdown_create"
    || action === "folder_organize"
    || action === "workspace_workflow"
    || action === "skill_authoring"
    || action === "skill_draft_proposal";
}

/** 채팅 결과 UI는 Query와 문서 명령 두 표현만 사용한다. */
export function resolveChatTurnPresentation(action: string | undefined): ChatTurnPresentation {
  if (isDocumentCommandAction(action)) return { kind: "document-command", action };
  return { kind: "query", grounded: !action || action === "chat_answer" };
}

/** 작업 탭 요청을 만든다. 열린 문서(context)가 없으면 문서 없이 보낸다(폴더 정리·폴더 스킬). */
export function buildAgentTurnRequest(
  message: string,
  context: Pick<ActiveMarkdownEditContext, "documentId" | "baseVersion" | "editorSnapshot"> | null,
  requestContext: AgentTurnRequestContext
): AgentTurnRequest {
  const referenceDocumentIds = requestContext.referenceDocumentIds ?? [];
  const base = {
    session_id: requestContext.sessionId,
    message,
    provider: requestContext.selectedModel.provider,
    model: requestContext.selectedModel.model,
    allow_web_search: requestContext.allowWebSearch ?? false,
    mode: AGENT_TURN_TASK_MODE,
    // 선택한 문답이 있을 때만 서버가 지원하는 pair ID 계약으로 전달한다.
    ...(requestContext.selectedPairIds.length > 0
      ? { conversationContext: { selected_pair_ids: requestContext.selectedPairIds } }
      : {}),
    ...(requestContext.folderId ? { folder_id: requestContext.folderId } : {}),
    ...(referenceDocumentIds.length > 0 ? { reference_document_ids: referenceDocumentIds } : {})
  } as const;
  if (!context) {
    return requestContext.readOnlyDocumentId ? { ...base, read_only_document_id: requestContext.readOnlyDocumentId } : base;
  }
  return { ...base, documentId: context.documentId, baseVersion: context.baseVersion, editorSnapshot: context.editorSnapshot };
}

export function buildGeneratedMarkdownFilename(title: string): string {
  const safeTitle = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "AI 문서";
  return safeTitle.toLowerCase().endsWith(".md") ? safeTitle : `${safeTitle}.md`;
}

/** AI 초안 새 문서의 생성 요청 값. 본문 앞에 노트 표시를 붙이고, 서버가 `.md`를 붙이므로 표시 이름에서는 뺀다. */
export function buildGeneratedMarkdownDocument(draft: GeneratedMarkdownDraft, noteId: string): { displayName: string; markdown: string } {
  const body = draft.markdown.endsWith("\n") ? draft.markdown : `${draft.markdown}\n`;
  return {
    displayName: buildGeneratedMarkdownFilename(draft.title).slice(0, -".md".length),
    markdown: `<!-- fruition-note: ${noteId} -->\n${body}`
  };
}

function targetsMatch(request: DocumentAgentTurnRequest, edit: AgentTurnEdit): boolean {
  const requestTarget = request.editorSnapshot.target;
  return requestTarget.type === edit.requested_target.type
    && requestTarget.startLine === edit.requested_target.start_line
    && requestTarget.endLine === edit.requested_target.end_line;
}

// 끝난 편집 turn에서 편집안이 지워졌을 때의 안내는 agentChat.edit.purged다. 문서를 영구 삭제하면 AI가 result.edit를 뺀다(ai document-purge).

/**
 * 문서 영구 삭제로 편집안이 지워진 turn인지. 끝난 turn은 result.edit만 사라지고(ai document-purge),
 * 수락을 기다리던 turn은 failed·document_purged로 닫힌다(document DocumentCopyScrubber).
 */
export function isPurgedEditTurn(turn: { status?: string | null; error?: string | null; result?: { action?: string | null; edit?: unknown } | null }): boolean {
  if (turn.error === "document_purged") return true;
  return turn.status === "completed" && turn.result?.action === "markdown_edit" && !turn.result.edit;
}

/** 편집안을 쓸 수 없을 때의 오류. code는 agentChat.edit.invalid 아래 메시지 키이고 purged는 문서 영구 삭제다. */
export class MarkdownEditPreviewError extends Error {
  readonly code: MarkdownEditPreviewErrorCode;

  constructor(code: MarkdownEditPreviewErrorCode, message: string) {
    super(message);
    this.name = "MarkdownEditPreviewError";
    this.code = code;
  }
}

export type MarkdownEditPreviewErrorCode =
  | "noDocument" | "documentMismatch" | "versionMismatch" | "notEdit" | "purged" | "targetMismatch" | "empty" | "insertTarget" | "outOfRange" | "changed";

function editError(code: MarkdownEditPreviewErrorCode, t: AgentChatTranslator): MarkdownEditPreviewError {
  return new MarkdownEditPreviewError(code, code === "purged" ? t("edit.purged") : t(`edit.invalid.${code}`));
}

export function prepareMarkdownEditPreview(
  anyRequest: AgentTurnRequest,
  response: AgentTurnResponse,
  t: AgentChatTranslator
): MarkdownEditPreview {
  if (!isDocumentAgentTurnRequest(anyRequest)) throw editError("noDocument", t);
  const request = anyRequest;
  if (response.documentId !== request.documentId) throw editError("documentMismatch", t);
  if (response.baseVersion !== request.baseVersion) throw editError("versionMismatch", t);
  if (response.result.action !== "markdown_edit") throw editError("notEdit", t);
  if (!response.result.edit) throw editError("purged", t);
  if (!targetsMatch(request, response.result.edit)) throw editError("targetMismatch", t);
  const edit = response.result.edit;
  const actualTarget = edit.actual_target;
  if (!edit.replacement_markdown.trim()) throw editError("empty", t);
  if (edit.operation === "insert_after"
    && actualTarget.type !== "current_section"
    && actualTarget.type !== "whole_document") {
    throw editError("insertTarget", t);
  }

  const sourceLines = request.editorSnapshot.markdown.split("\n");
  if (actualTarget.start_line < 1
    || actualTarget.end_line < actualTarget.start_line
    || actualTarget.end_line > sourceLines.length) {
    throw editError("outOfRange", t);
  }

  const replacementLines = edit.replacement_markdown.split("\n");
  const originalLines = sourceLines.slice(actualTarget.start_line - 1, actualTarget.end_line);
  const nextLines = [...sourceLines];
  if (edit.operation === "replace") {
    nextLines.splice(actualTarget.start_line - 1, originalLines.length, ...replacementLines);
  } else {
    nextLines.splice(actualTarget.end_line, 0, ...replacementLines);
  }

  return {
    operation: edit.operation,
    summary: edit.summary,
    replacementMarkdown: edit.replacement_markdown,
    nextMarkdown: nextLines.join("\n"),
    diffLines: edit.operation === "replace"
      ? lineDiff(originalLines.join("\n"), edit.replacement_markdown)
      : replacementLines.map((text) => ({ type: "insert" as const, text }))
  };
}

export function validateMarkdownEditApplication(
  request: AgentTurnRequest,
  response: AgentTurnResponse,
  currentContext: Pick<ActiveMarkdownEditContext, "documentId" | "editorSnapshot">,
  t: AgentChatTranslator
): void {
  prepareMarkdownEditPreview(request, response, t);
  if (currentContext.documentId !== request.documentId
    || currentContext.editorSnapshot.markdown !== request.editorSnapshot?.markdown) {
    throw editError("changed", t);
  }
}
