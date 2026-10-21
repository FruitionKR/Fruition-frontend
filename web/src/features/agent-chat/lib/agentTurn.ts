import type { ActiveMarkdownEditContext, MarkdownEditorSnapshot } from "./markdownEditContext";
import type { AiModelSelection } from "@/entities/ai";
import { lineDiff, type MarkdownDiffLine } from "@/shared/lib/lineDiff";

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
};

export type AgentTurnAction =
  | "chat_answer"
  | "conversation_reply"
  | "markdown_edit"
  | "markdown_create"
  | "clarify"
  | "reject"
  | "folder_organize"
  | "workspace_workflow"
  | "skill_authoring"
  | "skill_draft_proposal";

export type DocumentCommandAction = Exclude<AgentTurnAction, "chat_answer" | "conversation_reply" | "clarify" | "reject">;

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
    ...(requestContext.folderId ? { folder_id: requestContext.folderId } : {})
  } as const;
  if (!context) return base;
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

function targetsMatch(request: DocumentAgentTurnRequest, edit: AgentTurnEdit): boolean {
  const requestTarget = request.editorSnapshot.target;
  return requestTarget.type === edit.requested_target.type
    && requestTarget.startLine === edit.requested_target.start_line
    && requestTarget.endLine === edit.requested_target.end_line;
}

export function prepareMarkdownEditPreview(
  anyRequest: AgentTurnRequest,
  response: AgentTurnResponse
): MarkdownEditPreview {
  if (!isDocumentAgentTurnRequest(anyRequest)) {
    throw new Error("문서를 열지 않은 요청에는 편집안을 적용할 수 없습니다. 문서를 열고 다시 요청해주세요.");
  }
  const request = anyRequest;
  if (response.documentId !== request.documentId) {
    throw new Error("응답 문서가 요청 문서와 일치하지 않습니다.");
  }
  if (response.baseVersion !== request.baseVersion) {
    throw new Error("응답의 문서 version이 요청과 일치하지 않습니다.");
  }
  if (response.result.action !== "markdown_edit" || !response.result.edit) {
    throw new Error("Markdown 편집 응답이 아닙니다.");
  }
  if (!targetsMatch(request, response.result.edit)) {
    throw new Error("응답의 편집 대상이 요청 범위와 일치하지 않습니다.");
  }
  const edit = response.result.edit;
  const actualTarget = edit.actual_target;
  if (!edit.replacement_markdown.trim()) {
    throw new Error("비어 있는 Markdown 편집 결과는 적용할 수 없습니다.");
  }
  if (edit.operation === "insert_after"
    && actualTarget.type !== "current_section"
    && actualTarget.type !== "whole_document") {
    throw new Error("이어 쓰기 대상이 section 또는 전체 문서가 아닙니다.");
  }

  const sourceLines = request.editorSnapshot.markdown.split("\n");
  if (actualTarget.start_line < 1
    || actualTarget.end_line < actualTarget.start_line
    || actualTarget.end_line > sourceLines.length) {
    throw new Error("Markdown 편집 범위가 문서 경계를 벗어났습니다.");
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
  currentContext: Pick<ActiveMarkdownEditContext, "documentId" | "editorSnapshot">
): void {
  prepareMarkdownEditPreview(request, response);
  if (currentContext.documentId !== request.documentId
    || currentContext.editorSnapshot.markdown !== request.editorSnapshot?.markdown) {
    throw new Error("요청 이후 문서가 변경되었습니다. 최신 내용으로 재생성해주세요.");
  }
}
