// 프로세스 수명 동안 유지되는 인메모리 상태와 공용 헬퍼.
import { createHash, randomUUID } from "node:crypto";

export const state = {
  users: [],
  tokens: new Map(),
  refreshTokens: new Map(),
  mfaTokens: new Map(),
  verifications: new Map(),
  verificationTokens: new Set(),
  loginSessions: [],
  workspaces: [],
  members: [],
  invitations: [],
  documents: [],
  wikiPages: [],
  wikiEdges: [],
  chatSessions: [],
  chatMessages: [],
  queryRuns: new Map(),
  agentTurns: new Map(),
  agentRuns: new Map(),
  operationLogs: [],
  lintRuns: new Map(),
  skills: [],
  aiModels: []
};

export const now = () => new Date().toISOString();
export const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
export const id = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;
export const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function error(ctx, status, message, code) {
  ctx.json(status, { error: { message, ...(code ? { code } : {}) } });
}

/** 워크스페이스 멤버가 아니면 403. 워크스페이스가 없으면 404. 성공 시 워크스페이스를 반환한다. */
export function requireWorkspace(ctx) {
  const workspace = state.workspaces.find((item) => item.id === ctx.params.wid && !item.deleted_at);
  if (!workspace) {
    error(ctx, 404, "워크스페이스를 찾을 수 없습니다.");
    return null;
  }
  const isMember = state.members.some((member) => member.workspace_id === workspace.id && member.user_id === ctx.user.id);
  if (!isMember) {
    error(ctx, 403, "워크스페이스 권한이 없습니다.");
    return null;
  }
  return workspace;
}

export function findDocument(workspaceId, documentId) {
  return state.documents.find((doc) => doc.workspace_id === workspaceId && doc.id === documentId && !doc.deleted_at) ?? null;
}

const PUBLIC_DOCUMENT_FIELDS = [
  "id", "filename", "mime_type", "byte_size", "status", "source_uri", "uploaded_at", "document_role",
  "extracted_text_uri", "processed_at", "processing_started_at", "updated_at", "error_message",
  "processing_state", "processing_stage", "needs_reingest"
];

/** 내부 필드(본문·버전)를 제외한 문서 요약 응답. */
export function toDocumentItem(doc) {
  const item = {};
  for (const key of PUBLIC_DOCUMENT_FIELDS) {
    if (doc[key] !== undefined && doc[key] !== null) item[key] = doc[key];
  }
  return item;
}

export function isMarkdownDocument(doc) {
  return doc.document_role === "EDITABLE" && /\.(md|markdown)$/i.test(doc.filename);
}

export function slugify(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "page";
}

export function addOperationLog(workspaceId, entry) {
  const log = {
    operation_id: id("op"),
    workspace_id: workspaceId,
    status: "processing",
    target_document_id: null,
    target_display_name: null,
    summary: null,
    changed_resource_count: 0,
    restored_from: null,
    created_at: now(),
    completed_at: null,
    changes: [],
    ...entry
  };
  state.operationLogs.unshift(log);
  return log;
}

export function touchWiki(workspace) {
  workspace.maintenance.needs_lint = true;
  workspace.maintenance.last_wiki_change_at = now();
}

export function upsertMessage(sessionId, message) {
  const session = state.chatSessions.find((item) => item.id === sessionId);
  const created = {
    id: id("msg"),
    session_id: sessionId,
    status: "completed",
    created_at: now(),
    references: [],
    ...message
  };
  state.chatMessages.push(created);
  if (session) session.last_message_at = created.created_at;
  return created;
}
