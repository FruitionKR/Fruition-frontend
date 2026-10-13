// document-svc(8080) 채팅 라우트: 세션 목록·생성·삭제, 메시지, 질의 run 생성, 채팅 위키 편입.
import { state, now, id, hash, error, requireWorkspace } from "../state.mjs";
import { createQueryRun } from "./query.mjs";

function toSession({ id: sessionId, title, created_at, last_message_at }) {
  return { id: sessionId, title, created_at, last_message_at };
}

function requireSession(ctx, workspace) {
  const session = state.chatSessions.find((item) => item.workspace_id === workspace.id && item.id === ctx.params.sid);
  if (!session) error(ctx, 404, "채팅 세션을 찾을 수 없습니다.");
  return session;
}

function toMessage(message) {
  const { session_id, ...rest } = message;
  return rest;
}

export function registerChatRoutes(router) {
  router.get("/api/workspaces/:wid/chat/sessions", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const sessions = state.chatSessions
      .filter((session) => session.workspace_id === workspace.id)
      .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
      .map(toSession);
    ctx.json(200, { sessions });
  });

  router.post("/api/workspaces/:wid/chat/sessions", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { title } = await ctx.body();
    const timestamp = now();
    const session = { id: id("chat"), workspace_id: workspace.id, title: typeof title === "string" && title.trim() ? title.trim() : null, created_at: timestamp, last_message_at: timestamp };
    state.chatSessions.push(session);
    ctx.json(201, toSession(session));
  });

  router.delete("/api/workspaces/:wid/chat/sessions/:sid", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const session = requireSession(ctx, workspace);
    if (!session) return;
    state.chatSessions = state.chatSessions.filter((item) => item !== session);
    state.chatMessages = state.chatMessages.filter((message) => message.session_id !== session.id);
    ctx.json(204);
  });

  router.get("/api/workspaces/:wid/chat/sessions/:sid/messages", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const session = requireSession(ctx, workspace);
    if (!session) return;
    ctx.json(200, { messages: state.chatMessages.filter((message) => message.session_id === session.id).map(toMessage) });
  });

  router.post("/api/workspaces/:wid/chat/sessions/:sid/query/runs", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const session = requireSession(ctx, workspace);
    if (!session) return;
    const { question, provider, model, allow_web_search } = await ctx.body();
    if (typeof question !== "string" || !question.trim()) return error(ctx, 400, "질문을 입력해주세요.");
    if (!state.aiModels.some((item) => item.provider === provider && item.model === model)) return error(ctx, 400, "지원하지 않는 provider/model 조합입니다.");
    if (typeof allow_web_search !== "boolean") return error(ctx, 400, "allow_web_search 값이 필요합니다.");
    const run = createQueryRun(workspace, session, question.trim(), { provider, model, allow_web_search });
    if (!session.title) session.title = question.trim().slice(0, 30);
    ctx.json(202, { request_id: run.id, status: run.status });
  });

  /** 선택한 문답을 원문 문서로 저장한다. 같은 내용이면 기존 문서를 돌려준다(skipped). */
  router.post("/api/workspaces/:wid/chat/sessions/:sid/wiki", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const session = requireSession(ctx, workspace);
    if (!session) return;
    const { selection_mode, pair_ids } = await ctx.body();
    const messages = state.chatMessages.filter((message) => message.session_id === session.id
      && (selection_mode !== "partial" || (pair_ids ?? []).includes(message.pair_id)));
    if (messages.length === 0) return error(ctx, 400, "편입할 문답이 없습니다.");
    const body = messages.map((message) => `## ${message.role === "user" ? "질문" : "답변"}\n\n${message.content}\n`).join("\n");
    const markdown = `<!-- fruition-note: chat-export ${session.id} -->\n# ${session.title ?? "채팅 내보내기"}\n\n${body}`;
    const contentHash = hash(markdown);
    const existing = state.documents.find((doc) => doc.workspace_id === workspace.id && !doc.deleted_at && doc.export_hash === contentHash);
    if (existing) return ctx.json(200, { exportDocumentId: existing.id, status: "skipped" });
    const timestamp = now();
    const buffer = Buffer.from(markdown, "utf8");
    const doc = {
      id: id("doc"), workspace_id: workspace.id, filename: `${session.title ?? "채팅"} 내보내기.md`, mime_type: "text/markdown", byte_size: buffer.length,
      status: "uploaded", source_uri: `mock://chat/${session.id}`, uploaded_at: timestamp, updated_at: timestamp, document_role: "EDITABLE",
      markdown, content: buffer, current_version: 1, edit_revision: 1, export_hash: contentHash,
      versions: [{ version: 1, content_hash: contentHash, created_by: ctx.user.id, created_at: timestamp, markdown }]
    };
    state.documents.push(doc);
    ctx.json(201, { exportDocumentId: doc.id, status: "saved" });
  });
}
