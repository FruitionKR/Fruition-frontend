// document-svc(8080) 부가 라우트: AI 모델 카탈로그·워크스페이스 모델 설정·AI 작업 로그·스킬.
import { state, now, id, error, requireWorkspace, slugify } from "../state.mjs";

const DEFAULT_LOG_PAGE_SIZE = 20;
const MAX_LOG_PAGE_SIZE = 100;
const SKILL_ISSUE_RULES = [
  { pattern: /ignore (all |the )?(previous|above)|이전 지시.*무시|시스템 프롬프트/i, category: "instruction_override", reason: "기존 지시를 무시하도록 유도합니다." },
  { pattern: /api[_ ]?key|secret|password|비밀번호|토큰/i, category: "secret", reason: "비밀 정보가 스킬 본문에 포함되어 있습니다." }
];

function isOwner(ctx, workspace) {
  return state.members.some((member) => member.workspace_id === workspace.id && member.user_id === ctx.user.id && member.role === "OWNER");
}

function toLogItem(log) {
  const { workspace_id, changes, ...item } = log;
  return item;
}

function detectSkillIssues(text) {
  return text.split("\n").flatMap((line) => {
    const rule = SKILL_ISSUE_RULES.find((item) => item.pattern.test(line));
    return rule ? [{ severity: "blocked", category: rule.category, text: line.trim(), reason: rule.reason, section: null }] : [];
  });
}

function buildSkillMarkdown(name, description, instructions) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}`;
}

function toAuthoringResult(skill, version, issues = []) {
  return {
    skill_id: skill.id, version_id: version.id, name: version.name, description: version.description,
    instructions_markdown: version.instructions_markdown, skill_markdown: buildSkillMarkdown(version.name, version.description, version.instructions_markdown),
    scope_type: skill.scope_type, status: version.status, allowed_tools: version.allowed_tools, capabilities: version.capabilities, issues, question: null
  };
}

function findSkill(ctx, workspace) {
  const skill = state.skills.find((item) => item.workspace_id === workspace.id && item.id === ctx.params.skillId);
  if (!skill) error(ctx, 404, "스킬을 찾을 수 없습니다.");
  return skill;
}

export function registerCatalogRoutes(router) {
  router.get("/api/ai-models", (ctx) => ctx.json(200, { models: state.aiModels }));

  router.get("/api/workspaces/:wid/ai-model-settings", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    ctx.json(200, { ingest_lint: { ...workspace.ai_model_settings }, can_update: isOwner(ctx, workspace) });
  });

  router.put("/api/workspaces/:wid/ai-model-settings", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    if (!isOwner(ctx, workspace)) return error(ctx, 403, "워크스페이스 OWNER만 변경할 수 있습니다.");
    const { ingest_lint } = await ctx.body();
    if (!state.aiModels.some((item) => item.provider === ingest_lint?.provider && item.model === ingest_lint?.model)) return error(ctx, 400, "지원하지 않는 provider/model 조합입니다.");
    workspace.ai_model_settings = { provider: ingest_lint.provider, model: ingest_lint.model };
    ctx.json(200, { ingest_lint: { ...workspace.ai_model_settings }, can_update: true });
  });

  router.get("/api/workspaces/:wid/ai-operation-logs", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const type = ctx.query.get("type");
    const status = ctx.query.get("status");
    const size = Math.min(MAX_LOG_PAGE_SIZE, Math.max(1, Number(ctx.query.get("size")) || DEFAULT_LOG_PAGE_SIZE));
    const cursor = Number(ctx.query.get("cursor")) || 0;
    const filtered = state.operationLogs
      .filter((log) => log.workspace_id === workspace.id && (!type || log.operation_type === type) && (!status || log.status === status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const pageItems = filtered.slice(cursor, cursor + size);
    const nextCursor = cursor + size < filtered.length ? String(cursor + size) : null;
    ctx.json(200, { logs: pageItems.map(toLogItem), next_cursor: nextCursor });
  });

  router.get("/api/workspaces/:wid/ai-operation-logs/:opId", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const log = state.operationLogs.find((item) => item.workspace_id === workspace.id && item.operation_id === ctx.params.opId);
    if (!log) return error(ctx, 404, "작업 로그를 찾을 수 없습니다.");
    ctx.json(200, { ...toLogItem(log), changes: log.changes });
  });

  router.get("/api/workspaces/:wid/ai-operation-logs/:opId/restore-preview", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const log = state.operationLogs.find((item) => item.workspace_id === workspace.id && item.operation_id === ctx.params.opId);
    if (!log) return error(ctx, 404, "작업 로그를 찾을 수 없습니다.");
    const pages = log.changes.filter((change) => change.resource_type === "wiki_page").map((change) => ({
      page_id: change.resource_id, action: change.change_type === "created" ? "delete" : "restore", target_revision: change.before_revision, contribution_count: 1
    }));
    const documentChange = log.changes.find((change) => change.resource_type === "document");
    ctx.json(200, {
      operation_id: log.operation_id,
      delete_count: pages.filter((page) => page.action === "delete").length,
      restore_count: pages.filter((page) => page.action === "restore").length,
      rebuild_count: 0,
      pages,
      ...(documentChange ? { document: { document_id: documentChange.resource_id, from_version: documentChange.after_revision, to_version: documentChange.before_revision } } : {}),
      preview_token: `preview-${log.operation_id}-${Date.now()}`
    });
  });

  router.post("/api/workspaces/:wid/ai-operation-logs/:opId/restore", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const source = state.operationLogs.find((item) => item.workspace_id === workspace.id && item.operation_id === ctx.params.opId);
    if (!source) return error(ctx, 404, "작업 로그를 찾을 수 없습니다.");
    const { preview_token } = await ctx.body();
    if (typeof preview_token !== "string" || !preview_token.startsWith(`preview-${source.operation_id}-`)) return error(ctx, 409, "미리보기 토큰이 만료되었습니다. 다시 확인해주세요.");
    const restore = { operation_id: id("op"), workspace_id: workspace.id, operation_type: "restore", status: "processing", target_document_id: source.target_document_id, target_display_name: source.target_display_name, summary: `${source.summary ?? source.operation_type} 롤백`, changed_resource_count: source.changed_resource_count, restored_from: source.operation_id, created_at: now(), completed_at: null, changes: [] };
    state.operationLogs.unshift(restore);
    setTimeout(() => { restore.status = "succeeded"; restore.completed_at = now(); }, 2500);
    ctx.json(202, { operation_id: restore.operation_id, restored_from: source.operation_id, status: "queued" });
  });

  router.get("/api/workspaces/:wid/skills", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    ctx.json(200, state.skills.filter((skill) => skill.workspace_id === workspace.id));
  });

  router.post("/api/workspaces/:wid/skills/author", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { instruction, name, description, scope_type } = await ctx.body();
    if (typeof instruction !== "string" || !instruction.trim()) return error(ctx, 400, "스킬 지시문을 입력해주세요.");
    const skillName = (name ?? slugify(instruction.slice(0, 20))).trim();
    const version = { id: id("sv"), name: skillName, description: description || instruction.slice(0, 60), status: "draft", version: 1, allowed_tools: ["read_document"], capabilities: ["summarize"], instructions_markdown: `# ${skillName}\n\n${instruction.trim()}\n\n## 절차\n\n1. 대상 문서를 읽는다.\n2. 지시에 맞게 결과를 작성한다.\n` };
    ctx.json(200, toAuthoringResult({ id: id("skill"), scope_type: scope_type ?? "personal" }, version, detectSkillIssues(instruction)));
  });

  router.post("/api/workspaces/:wid/skills/author/publish", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { name, description, instructions_markdown, scope_type, allowed_tools, capabilities } = await ctx.body();
    if (typeof name !== "string" || !name.trim()) return error(ctx, 400, "스킬 이름을 입력해주세요.");
    const slug = slugify(name);
    if (state.skills.some((skill) => skill.workspace_id === workspace.id && skill.slug === slug)) return error(ctx, 409, "같은 이름의 스킬이 이미 있습니다.");
    const version = { id: id("sv"), name: slug, description: description ?? "", status: "published", version: 1, allowed_tools: allowed_tools ?? [], capabilities: capabilities ?? [], instructions_markdown: instructions_markdown ?? "" };
    const skill = { id: id("skill"), workspace_id: workspace.id, owner_user_id: ctx.user.id, slug, scope_type: scope_type ?? "personal", status: "enabled", enabled_version: version, latest_version: version };
    state.skills.push(skill);
    ctx.json(201, toAuthoringResult(skill, version));
  });

  router.patch("/api/workspaces/:wid/skills/:skillId", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const skill = findSkill(ctx, workspace);
    if (!skill) return;
    const body = await ctx.body();
    const base = skill.latest_version ?? skill.enabled_version;
    const version = { ...base, id: id("sv"), version: (base?.version ?? 0) + 1, name: body.name ?? base.name, description: body.description ?? base.description, instructions_markdown: body.instructions_markdown ?? base.instructions_markdown };
    skill.latest_version = version;
    if (skill.enabled_version) skill.enabled_version = version;
    ctx.json(200, toAuthoringResult(skill, version));
  });

  router.post("/api/workspaces/:wid/skills/:skillId/enable", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const skill = findSkill(ctx, workspace);
    if (!skill) return;
    skill.enabled_version = skill.latest_version;
    skill.status = "enabled";
    ctx.json(200, skill);
  });

  router.post("/api/workspaces/:wid/skills/:skillId/disable", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const skill = findSkill(ctx, workspace);
    if (!skill) return;
    skill.enabled_version = null;
    skill.status = "disabled";
    ctx.json(200, skill);
  });
}
