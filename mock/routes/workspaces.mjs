// access-svc(8081) 워크스페이스·아이콘·멤버·초대 라우트.
import { state, now, id, error, requireWorkspace } from "../state.mjs";

function toWorkspace(workspace) {
  const { id: wid, name, icon_emoji, icon_url, created_at, updated_at } = workspace;
  return { id: wid, name, icon_emoji, icon_url, created_at, updated_at };
}

function toMember(member) {
  const user = state.users.find((item) => item.id === member.user_id);
  return {
    user_id: member.user_id,
    email: user?.email ?? "",
    display_name: user?.display_name ?? null,
    provider: user?.provider ?? "email",
    role: member.role,
    joined_at: member.joined_at
  };
}

function requireOwner(ctx, workspace) {
  const member = state.members.find((item) => item.workspace_id === workspace.id && item.user_id === ctx.user.id);
  if (member?.role !== "OWNER") {
    error(ctx, 403, "워크스페이스 OWNER만 할 수 있습니다.");
    return false;
  }
  return true;
}

export function registerWorkspaceRoutes(router) {
  router.get("/api/workspaces", (ctx) => {
    const memberships = state.members.filter((member) => member.user_id === ctx.user.id).map((member) => member.workspace_id);
    const workspaces = state.workspaces.filter((workspace) => memberships.includes(workspace.id) && !workspace.deleted_at).map(toWorkspace);
    ctx.json(200, { workspaces });
  });

  router.post("/api/workspaces", async (ctx) => {
    const { name } = await ctx.body();
    if (typeof name !== "string" || !name.trim()) return error(ctx, 400, "워크스페이스 이름을 입력해주세요.");
    const timestamp = now();
    const workspace = {
      id: id("ws"), name: name.trim(), icon_emoji: null, icon_url: null, icon_image: null, owner_id: ctx.user.id,
      created_at: timestamp, updated_at: timestamp,
      ai_model_settings: { ...state.aiModels[0] },
      maintenance: { needs_lint: false, last_lint_at: null, last_wiki_change_at: null }
    };
    state.workspaces.push(workspace);
    state.members.push({ workspace_id: workspace.id, user_id: ctx.user.id, role: "OWNER", joined_at: timestamp });
    state.chatSessions.push({ id: id("chat"), workspace_id: workspace.id, title: null, created_at: timestamp, last_message_at: timestamp });
    ctx.json(201, toWorkspace(workspace));
  });

  router.patch("/api/workspaces/:wid", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { name } = await ctx.body();
    if (typeof name === "string" && name.trim()) workspace.name = name.trim();
    workspace.updated_at = now();
    ctx.json(200, toWorkspace(workspace));
  });

  router.delete("/api/workspaces/:wid", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace || !requireOwner(ctx, workspace)) return;
    workspace.deleted_at = now();
    ctx.json(204);
  });

  router.put("/api/workspaces/:wid/icon", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { icon_emoji } = await ctx.body();
    workspace.icon_emoji = typeof icon_emoji === "string" && icon_emoji ? icon_emoji : null;
    workspace.icon_url = null;
    workspace.icon_image = null;
    workspace.updated_at = now();
    ctx.json(200, toWorkspace(workspace));
  });

  router.put("/api/workspaces/:wid/icon/image", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { file } = await ctx.body();
    if (!file?.buffer) return error(ctx, 400, "이미지 파일이 필요합니다.");
    workspace.icon_image = { type: file.type || "image/png", buffer: file.buffer };
    workspace.icon_url = `/api/workspaces/${workspace.id}/icon/image`;
    workspace.icon_emoji = null;
    workspace.updated_at = now();
    ctx.json(200, toWorkspace(workspace));
  });

  router.get("/api/workspaces/:wid/icon/image", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    if (!workspace.icon_image) return error(ctx, 404, "아이콘 이미지가 없습니다.");
    ctx.bytes(200, workspace.icon_image.buffer, workspace.icon_image.type);
  });

  router.get("/api/workspaces/:wid/members", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    ctx.json(200, { members: state.members.filter((member) => member.workspace_id === workspace.id).map(toMember) });
  });

  router.patch("/api/workspaces/:wid/members/:uid", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace || !requireOwner(ctx, workspace)) return;
    const member = state.members.find((item) => item.workspace_id === workspace.id && item.user_id === ctx.params.uid);
    if (!member) return error(ctx, 404, "멤버를 찾을 수 없습니다.");
    const { role } = await ctx.body();
    if (role !== "OWNER" && role !== "MEMBER") return error(ctx, 400, "역할 값이 올바르지 않습니다.");
    member.role = role;
    ctx.json(200, toMember(member));
  });

  router.delete("/api/workspaces/:wid/members/:uid", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace || !requireOwner(ctx, workspace)) return;
    if (ctx.params.uid === ctx.user.id) return error(ctx, 400, "자기 자신은 제거할 수 없습니다.");
    state.members = state.members.filter((member) => !(member.workspace_id === workspace.id && member.user_id === ctx.params.uid));
    ctx.json(204);
  });

  router.post("/api/workspaces/:wid/invitations", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace || !requireOwner(ctx, workspace)) return;
    const { email, role } = await ctx.body();
    if (typeof email !== "string" || !email.includes("@")) return error(ctx, 400, "이메일이 올바르지 않습니다.");
    const invitation = {
      id: id("inv"), token: `mock-${id("invite")}`, workspace_id: workspace.id, email: email.toLowerCase(),
      role: role === "OWNER" ? "OWNER" : "MEMBER", invited_by: ctx.user.email,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(), created_at: now()
    };
    state.invitations.push(invitation);
    console.log(`[mock] 초대 링크: http://localhost:3000/invitations/${invitation.token}`);
    ctx.json(201, { invitation_id: invitation.id, token: invitation.token });
  });

  router.delete("/api/workspaces/:wid/invitations/:invitationId", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace || !requireOwner(ctx, workspace)) return;
    state.invitations = state.invitations.filter((item) => !(item.workspace_id === workspace.id && item.id === ctx.params.invitationId));
    ctx.json(204);
  });

  router.get("/api/invitations/:token", (ctx) => {
    const invitation = state.invitations.find((item) => item.token === ctx.params.token);
    const workspace = invitation && state.workspaces.find((item) => item.id === invitation.workspace_id);
    if (!invitation || !workspace) return error(ctx, 404, "초대를 찾을 수 없거나 만료되었습니다.");
    ctx.json(200, { workspace_id: workspace.id, workspace_name: workspace.name, email: invitation.email, role: invitation.role, invited_by: invitation.invited_by, expires_at: invitation.expires_at });
  }, { open: true });

  router.post("/api/invitations/:token/accept", (ctx) => {
    const invitation = state.invitations.find((item) => item.token === ctx.params.token);
    if (!invitation) return error(ctx, 404, "초대를 찾을 수 없거나 만료되었습니다.");
    const alreadyMember = state.members.some((member) => member.workspace_id === invitation.workspace_id && member.user_id === ctx.user.id);
    if (!alreadyMember) state.members.push({ workspace_id: invitation.workspace_id, user_id: ctx.user.id, role: invitation.role, joined_at: now() });
    state.invitations = state.invitations.filter((item) => item !== invitation);
    ctx.json(200, { workspace_id: invitation.workspace_id });
  });
}
