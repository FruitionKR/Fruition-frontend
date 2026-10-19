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
  folders: [],
  assets: [],
  wikiPages: [],
  wikiEdges: [],
  chatSessions: [],
  chatMessages: [],
  queryRuns: new Map(),
  agentTurns: new Map(),
  agentRuns: new Map(),
  operationLogs: [],
  lintRuns: new Map(),
  // 문서 id → { holder_user_id, holder_display_name, expires_at }
  editLocks: new Map(),
  // 앱 안 알림
  notifications: [],
  skills: [],
  aiModels: [],
  // 회의 받아쓰기(#148): 회의(구간·연결·회의록 초안 포함)와 WebSocket 일회용 ticket → { meetingId, expiresAt }
  meetings: [],
  meetingTickets: new Map()
};

export const now = () => new Date().toISOString();
export const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
export const id = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;
export const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 프로필 사진 조회 경로. 사진이 없으면 null. ?v=는 이미지 SHA-256이라 사진을 바꾸면 URL도 바뀐다. */
export function avatarUrlOf(user) {
  return user?.avatar ? `/api/users/${user.id}/avatar?v=${user.avatar.hash}` : null;
}

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
  "processing_state", "processing_stage", "needs_reingest", "pipeline_run_id", "source_document_id"
];

/** 내부 필드(본문·버전)를 제외한 문서 요약 응답. */
export function toDocumentItem(doc) {
  const item = {};
  for (const key of PUBLIC_DOCUMENT_FIELDS) {
    if (doc[key] !== undefined && doc[key] !== null) item[key] = doc[key];
  }
  return item;
}

/** 워크스페이스 안 사용자의 역할. 멤버가 아니면 null. */
export function memberRole(workspaceId, userId) {
  return state.members.find((member) => member.workspace_id === workspaceId && member.user_id === userId)?.role ?? null;
}

/** 문서에 적용되는 권한: 문서 자기 설정 → 가장 가까운 상위 폴더 설정 → 기본값 edit. */
export function effectivePermission(doc) {
  if (doc.permission) return doc.permission;
  let folderId = doc.folder_id ?? null;
  while (folderId) {
    const folder = state.folders.find((item) => item.id === folderId && item.workspace_id === doc.workspace_id);
    if (!folder) break;
    if (folder.permission) return folder.permission;
    folderId = folder.parent_folder_id ?? null;
  }
  return "edit";
}

/** 서버 DocumentAccessPolicy 흉내: 소유자·OWNER는 항상 편집·삭제, 그 외 멤버는 적용 권한이 edit일 때만 편집. */
export function documentAccess(doc, userId) {
  const isPrivileged = doc.owner_user_id === userId || memberRole(doc.workspace_id, userId) === "OWNER";
  return {
    can_edit: isPrivileged || effectivePermission(doc) === "edit",
    can_delete: isPrivileged,
    permission: doc.permission ?? null,
    updated_by: doc.updated_by ?? doc.owner_user_id ?? null
  };
}

/** 목록·트리·상세 응답용: 문서 요약에 호출자 기준 권한 필드를 붙인다. */
export function toDocumentItemFor(doc, userId) {
  return { ...toDocumentItem(doc), ...documentAccess(doc, userId) };
}

/** 편집 권한이 없으면 403 DOCUMENT_WRITE_FORBIDDEN을 보내고 false를 돌려준다. */
export function requireDocumentEdit(ctx, doc) {
  if (documentAccess(doc, ctx.user.id).can_edit) return true;
  error(ctx, 403, "이 문서를 편집할 권한이 없습니다.", "DOCUMENT_WRITE_FORBIDDEN");
  return false;
}

/** 삭제·복구는 문서 소유자와 OWNER만. */
export function requireDocumentDelete(ctx, doc) {
  if (documentAccess(doc, ctx.user.id).can_delete) return true;
  error(ctx, 403, "문서 소유자와 워크스페이스 OWNER만 삭제·복구할 수 있습니다.", "DOCUMENT_WRITE_FORBIDDEN");
  return false;
}

export const SKILL_REFERENCE_ORIGIN = "skill_reference";

/** 스킬 참고 문서. 문서 트리·기본 목록·위키 편입에서 빠진다. */
export function isSkillReference(doc) {
  return doc.origin === SKILL_REFERENCE_ORIGIN;
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
  // wiki/graph ETag("wiki-{버전}")의 근거. 위키가 바뀔 때마다 올린다(document #131).
  workspace.wiki_version = (workspace.wiki_version ?? 0) + 1;
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
