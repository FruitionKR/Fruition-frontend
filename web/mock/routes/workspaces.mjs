// access-svc(8081) 워크스페이스·아이콘·멤버·초대 라우트.
import { state, now, id, error, requireWorkspace, avatarUrlOf } from "../state.mjs";
import { FREE_WORKSPACE_LIMIT, freeWorkspaceCount, storageOf } from "../lib/limits.mjs";

// access #32: 멤버 권한 항목. OWNER는 항상 전부, MEMBER는 OWNER가 부여한 항목만.
const WORKSPACE_PERMISSIONS = ["wiki.ingest", "wiki.lint", "skill.author", "wiki.restore", "document.convert"];

function toWorkspace(workspace) {
  const { id: wid, name, icon_emoji, icon_url, created_at, updated_at } = workspace;
  return { id: wid, name, icon_emoji, icon_url, auto_ingest_on_upload: workspace.auto_ingest_on_upload === true, created_at, updated_at };
}

function toMember(member) {
  const user = state.users.find((item) => item.id === member.user_id);
  return {
    user_id: member.user_id,
    email: user?.email ?? "",
    display_name: user?.display_name ?? null,
    avatar_url: avatarUrlOf(user),
    provider: user?.provider ?? "email",
    role: member.role,
    permissions: member.role === "OWNER" ? [...WORKSPACE_PERMISSIONS] : [...(member.permissions ?? [])].sort(),
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
    ctx.json(200, { workspaces, free_workspace_count: freeWorkspaceCount(ctx.user.id), free_workspace_limit: FREE_WORKSPACE_LIMIT });
  });

  router.post("/api/workspaces", async (ctx) => {
    const { name } = await ctx.body();
    if (typeof name !== "string" || !name.trim()) return error(ctx, 400, "워크스페이스 이름을 입력해주세요.");
    if (freeWorkspaceCount(ctx.user.id) >= FREE_WORKSPACE_LIMIT) {
      return error(ctx, 409, "무료 워크스페이스는 더 만들 수 없습니다.", "WORKSPACE_LIMIT_EXCEEDED");
    }
    const timestamp = now();
    const workspace = {
      id: id("ws"), name: name.trim(), icon_emoji: null, icon_url: null, icon_image: null, owner_id: ctx.user.id,
      auto_ingest_on_upload: false, created_at: timestamp, updated_at: timestamp,
      ai_model_settings: { ...state.aiModels[0] },
      maintenance: { needs_lint: false, last_lint_at: null, last_wiki_change_at: null }
    };
    state.workspaces.push(workspace);
    state.members.push({ workspace_id: workspace.id, user_id: ctx.user.id, role: "OWNER", joined_at: timestamp });
    state.chatSessions.push({ id: id("chat"), workspace_id: workspace.id, title: null, created_at: timestamp, last_message_at: timestamp });
    ctx.json(201, toWorkspace(workspace));
  });

  router.get("/api/workspaces/:wid/storage", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    ctx.json(200, storageOf(workspace));
  });

  router.patch("/api/workspaces/:wid", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { name, auto_ingest_on_upload } = await ctx.body();
    const hasName = typeof name === "string" && name.trim();
    const hasAutoIngest = typeof auto_ingest_on_upload === "boolean";
    if (!hasName && !hasAutoIngest) return error(ctx, 400, "요청 형식이 올바르지 않습니다.", "INVALID_REQUEST");
    // access는 소유자가 아니면 이름 변경과 같은 규칙으로 404를 준다.
    const caller = state.members.find((item) => item.workspace_id === workspace.id && item.user_id === ctx.user.id);
    if (caller?.role !== "OWNER") return error(ctx, 404, "워크스페이스를 찾을 수 없습니다.", "WORKSPACE_NOT_FOUND");
    if (hasName) workspace.name = name.trim();
    if (hasAutoIngest) workspace.auto_ingest_on_upload = auto_ingest_on_upload;
    workspace.updated_at = now();
    ctx.json(200, toWorkspace(workspace));
  });

  router.delete("/api/workspaces/:wid", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace || !requireOwner(ctx, workspace)) return;
    // Access(IdempotencyService.validateKey)처럼 Idempotency-Key가 없거나 255자를 넘으면 거부한다.
    const key = ctx.req.headers["idempotency-key"] ?? "";
    if (key.length < 1 || key.length > 255) return error(ctx, 400, "Idempotency-Key는 1자 이상 255자 이하여야 합니다.");
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
    const { role, permissions } = await ctx.body();
    const hasRole = role !== undefined;
    const hasPermissions = permissions !== undefined;
    if (!hasRole && !hasPermissions) return error(ctx, 400, "요청 형식이 올바르지 않습니다.", "INVALID_REQUEST");
    if (hasRole && role !== "OWNER" && role !== "MEMBER") return error(ctx, 400, "역할 값이 올바르지 않습니다.", "INVALID_REQUEST");
    if (hasPermissions) {
      const isValid = Array.isArray(permissions)
        && permissions.every((item) => WORKSPACE_PERMISSIONS.includes(item))
        && new Set(permissions).size === permissions.length;
      if (!isValid) return error(ctx, 400, "알 수 없거나 중복된 권한 항목입니다.", "INVALID_REQUEST");
      // 결과 역할이 OWNER면 권한은 항상 전부라 바꿀 수 없다.
      if ((hasRole ? role : member.role) === "OWNER") return error(ctx, 400, "OWNER의 권한 항목은 바꿀 수 없습니다.", "OWNER_PERMISSIONS_FIXED");
    }
    if (hasRole) member.role = role;
    if (hasPermissions) member.permissions = [...permissions];
    ctx.json(200, toMember(member));
  });

  router.delete("/api/workspaces/:wid/members/:uid", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    // 본인 제거는 탈퇴다. 역할과 무관하게 허용하되 마지막 OWNER는 막는다. 타인 제거는 OWNER만 가능하다.
    if (ctx.params.uid === ctx.user.id) {
      const owners = state.members.filter((member) => member.workspace_id === workspace.id && member.role === "OWNER");
      if (owners.length === 1 && owners[0].user_id === ctx.user.id) return error(ctx, 400, "마지막 OWNER는 탈퇴할 수 없습니다.");
    } else if (!requireOwner(ctx, workspace)) return;
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
