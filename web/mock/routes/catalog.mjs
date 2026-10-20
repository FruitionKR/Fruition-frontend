// document-svc(8080) 부가 라우트: AI 모델 카탈로그·워크스페이스 모델 설정·AI 작업 로그·스킬.
import { state, now, id, error, requireWorkspace, slugify, findDocument, isMarkdownDocument, sleep } from "../state.mjs";

const DEFAULT_LOG_PAGE_SIZE = 20;
const MAX_LOG_PAGE_SIZE = 100;
// 실제 백엔드처럼 status를 비우면 진행 중·실패 로그는 목록에서 숨긴다.
const HIDDEN_DEFAULT_STATUSES = new Set(["processing", "applying", "notify_pending", "rebuilding", "failed", "conflict"]);
const SKILL_ISSUE_RULES = [
  { pattern: /ignore (all |the )?(previous|above)|이전 지시.*무시|시스템 프롬프트/i, category: "instruction_override", reason: "기존 지시를 무시하도록 유도합니다." },
  { pattern: /api[_ ]?key|secret|password|비밀번호|토큰/i, category: "secret", reason: "비밀 정보가 스킬 본문에 포함되어 있습니다." }
];
// 실제 백엔드의 author 거절 code를 재현한다. 자모만 나열한 지침은 의도 불명확, 나머지는 지침에 넣은 표식으로 고른다.
const SKILL_REJECT_RULES = [
  { pattern: /^[\sㄱ-ㅎㅏ-ㅣ]+$/, status: 400, code: "SKILL_INTENT_AMBIGUOUS", message: "어떤 작업을 반복할지 구체적으로 적어 주세요." },
  { pattern: /#불가능/, status: 400, code: "SKILL_INTENT_UNSUPPORTED", message: "지원하지 않는 작업입니다. 문서 작성·수정·폴더 정리·템플릿 중에서 골라 주세요." },
  { pattern: /#지침오류/, status: 400, code: "SKILL_INSTRUCTION_INVALID", message: "참조 문서를 확인해 주세요. 접근할 수 없거나 비어 있거나 너무 긴 문서가 있습니다." },
  // 참고 문서 한 개가 30,000자를 넘으면 document가 AI의 413 응답을 그대로 중계한다.
  { pattern: /#문서초과/, status: 413, code: "REFERENCE_DOCUMENT_TOO_LARGE", message: "EDITABLE 참조 문서는 30,000자 이하여야 합니다." },
  { pattern: /#거절/, status: 400, code: "SKILL_REQUEST_REJECTED", message: "Skill 요청이 거부되었습니다." },
  { pattern: /#AI장애/, status: 503, code: "SKILL_AI_UNAVAILABLE", message: "AI 서버를 사용할 수 없습니다." }
];

/** 초안 capability. 지침 표식으로 AI 분류를 재현한다: #새문서 → document-create, #고치기 → document-edit. */
function draftCapabilities(instruction) {
  if (/#새문서/.test(instruction)) return ["document-create"];
  if (/#고치기/.test(instruction)) return ["document-edit"];
  return ["summarize"];
}

// ai#122: 문서 Skill(document-create·document-edit)만 targets·result_mode를 가진다.
const DOCUMENT_CAPABILITIES = new Set(["document-create", "document-edit"]);
const TARGET_ORDER = ["current_document", "selection"];
const RESULT_MODE_CAPABILITIES = { create: ["document-create"], edit: ["document-edit"], auto: ["document-create", "document-edit"] };
// ai#121: allowed_tools를 생략하면 capabilities의 canonical Tool 합집합으로 계산한다(mock은 대표 Tool만 둔다).
const CAPABILITY_TOOLS = {
  "document-create": ["list_root_items", "list_folder_children", "get_document_content", "create_document"],
  "document-edit": ["list_root_items", "list_folder_children", "get_document_content", "apply_document_edit"],
  "folder-organize": ["list_root_items", "list_folder_children", "move_folder", "move_document", "rename_document"],
  template: ["list_root_items", "list_folder_children", "get_document_content", "create_document", "apply_document_edit"]
};
const usedTestRunIds = new Set();

function isDocumentSkill(capabilities) {
  return capabilities.some((capability) => DOCUMENT_CAPABILITIES.has(capability));
}

function canonicalTools(capabilities) {
  return [...new Set(capabilities.flatMap((capability) => CAPABILITY_TOOLS[capability] ?? []))];
}

/**
 * ai validate_execution_options 재현. 어긋나면 document가 중계하는 400 SKILL_INSTRUCTION_INVALID로 거절하고 undefined를 준다.
 * targets가 undefined(생략)면 fallback(게시 기본값 또는 수정 시 기존 값), []면 기본값이다.
 */
function executionOptions(ctx, capabilities, body, fallback) {
  const { targets, result_mode } = body;
  if (Array.isArray(targets) && new Set(targets).size !== targets.length) {
    return error(ctx, 400, "targets must not contain duplicates.", "SKILL_INSTRUCTION_INVALID");
  }
  if (!isDocumentSkill(capabilities)) {
    // document는 AI의 invalid_targets·invalid_result_mode를 따로 옮기지 않고 SKILL_REQUEST_REJECTED로 돌려준다.
    if ((targets ?? []).length > 0) return error(ctx, 400, "Skill 요청이 거부되었습니다.", "SKILL_REQUEST_REJECTED");
    if (result_mode != null) return error(ctx, 400, "Skill 요청이 거부되었습니다.", "SKILL_REQUEST_REJECTED");
    return { targets: [], result_mode: null };
  }
  const matches = (value) => value == null || (RESULT_MODE_CAPABILITIES[value] ?? ["?"]).every((capability) => capabilities.includes(capability));
  if (result_mode !== undefined && !matches(result_mode)) {
    return error(ctx, 400, "Skill 요청이 거부되었습니다.", "SKILL_REQUEST_REJECTED");
  }
  // 생략해 이어받은 값이 capabilities와 맞지 않으면 거절하지 않고 버린다(ai#122).
  const mode = result_mode !== undefined ? result_mode : matches(fallback.result_mode) ? fallback.result_mode : null;
  const chosen = targets === undefined ? fallback.targets : targets;
  const ordered = TARGET_ORDER.filter((target) => chosen.includes(target));
  return { targets: ordered.length > 0 ? ordered : ["current_document"], result_mode: mode ?? null };
}

/** 마크다운을 제목 기준 섹션으로 나눈다(1-based 줄 번호, 끝 포함). 제목 전 본문은 "(제목 없음)" 섹션이다. */
function markdownSections(markdown) {
  const lines = markdown.split("\n");
  const sections = [];
  lines.forEach((line, index) => {
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading || sections.length === 0) sections.push({ title: heading ? heading[1].trim() : "(제목 없음)", start: index + 1, end: index + 1 });
    else sections[sections.length - 1].end = index + 1;
  });
  return { lines, sections };
}

const isBodyLine = (line) => line.trim() !== "" && !line.startsWith("#");

/** ai skill_test_run 응답 모양 재현. 편집형은 범위와 겹치는 첫 섹션의 본문 첫 줄을 다듬은 것으로 바꾼다. */
function testRunResult(definition, markdown, target) {
  if (!definition.capabilities.includes("document-edit")) {
    const preview = `# ${definition.name}\n\n${definition.description}\n\n(테스트로 만들어질 문서 미리보기)\n`;
    return { status: "completed", changes: [], untouched_sections: [], result_markdown: preview, issues: [] };
  }
  const { lines, sections } = markdownSections(markdown);
  const start = target?.start_line ?? 1;
  const end = target?.end_line ?? lines.length;
  const section = sections.find((item) => item.end >= start && item.start <= end && lines.slice(item.start - 1, item.end).some(isBodyLine));
  if (!section) return { status: "completed", changes: [], untouched_sections: sections.map((item) => item.title), result_markdown: markdown, issues: [] };
  const bodyIndex = lines.findIndex((line, index) => index >= section.start - 1 && index < section.end && isBodyLine(line));
  const edited = lines.map((line, index) => (index === bodyIndex ? `${line.trim()} (스킬 규칙에 맞춰 다듬음)` : line));
  return {
    status: "completed",
    changes: [{
      section: section.title,
      start_line: section.start,
      end_line: section.end,
      before: lines.slice(section.start - 1, section.end).join("\n"),
      after: edited.slice(section.start - 1, section.end).join("\n")
    }],
    untouched_sections: sections.filter((item) => item !== section).map((item) => item.title),
    result_markdown: edited.join("\n"),
    issues: []
  };
}

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
    scope_type: skill.scope_type, status: version.status, allowed_tools: version.allowed_tools, capabilities: version.capabilities,
    targets: version.targets ?? [], result_mode: version.result_mode ?? null, issues, question: null
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
    // 실제 백엔드처럼 워크스페이스 공용 모델에는 Claude를 저장할 수 없다.
    if (ingest_lint.provider === "claude") return error(ctx, 400, "Claude 모델은 채팅에서 직접 선택할 때만 사용할 수 있습니다.");
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
      .filter((log) => log.workspace_id === workspace.id && (!type || log.operation_type === type) && (status ? log.status === status : !HIDDEN_DEFAULT_STATUSES.has(log.status)))
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
    // 실제 백엔드 상태 전이: applying → rebuilding → succeeded. 완료 시 생성 페이지는 deleted, 수정 페이지는 restored로 기록한다.
    const restore = { operation_id: id("op"), workspace_id: workspace.id, operation_type: "restore", status: "applying", target_document_id: source.target_document_id, target_display_name: source.target_display_name, summary: `${source.summary ?? source.operation_type} 롤백`, changed_resource_count: source.changed_resource_count, restored_from: source.operation_id, created_at: now(), completed_at: null, changes: [] };
    state.operationLogs.unshift(restore);
    setTimeout(() => { restore.status = "rebuilding"; }, 4000);
    setTimeout(() => {
      restore.status = "succeeded";
      restore.completed_at = now();
      restore.changes = source.changes.map((change, index) => change.change_type === "created"
        ? { id: 1000 + index, resource_type: change.resource_type, resource_id: change.resource_id, resource_display_name: change.resource_display_name, before_revision: change.after_revision, after_revision: null, change_type: "deleted", change_summary: "받치는 기여가 남지 않아 삭제했습니다.", additions: null, deletions: null }
        : { id: 1000 + index, resource_type: change.resource_type, resource_id: change.resource_id, resource_display_name: change.resource_display_name, before_revision: change.after_revision, after_revision: change.before_revision, change_type: "restored", change_summary: `revision ${change.before_revision} 내용으로 되돌렸습니다.`, additions: change.deletions, deletions: change.additions, hunks: change.hunks });
    }, 8000);
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
    const reject = SKILL_REJECT_RULES.find((rule) => rule.pattern.test(instruction));
    if (reject) return error(ctx, reject.status, reject.message, reject.code);
    const skillName = (name ?? slugify(instruction.slice(0, 20))).trim();
    const version = { id: id("sv"), name: skillName, description: description || instruction.slice(0, 60), status: "draft", version: 1, allowed_tools: ["read_document"], capabilities: draftCapabilities(instruction), instructions_markdown: `# ${skillName}\n\n${instruction.trim()}\n\n## 절차\n\n1. 대상 문서를 읽는다.\n2. 지시에 맞게 결과를 작성한다.\n` };
    ctx.json(200, toAuthoringResult({ id: id("skill"), scope_type: scope_type ?? "personal" }, version, detectSkillIssues(instruction)));
  });

  router.post("/api/workspaces/:wid/skills/author/publish", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const body = await ctx.body();
    const { name, description, instructions_markdown, scope_type, allowed_tools } = body;
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
    if (typeof name !== "string" || !name.trim()) return error(ctx, 400, "스킬 이름을 입력해주세요.");
    if (capabilities.length === 0) return error(ctx, 400, "capabilities는 1개 이상이어야 합니다.", "INVALID_REQUEST");
    const slug = slugify(name);
    if (state.skills.some((skill) => skill.workspace_id === workspace.id && skill.slug === slug)) return error(ctx, 409, "같은 이름의 스킬이 이미 있습니다.");
    // 게시에서 targets를 생략하거나 []이면 ["current_document"], result_mode를 생략하면 null이다.
    const options = executionOptions(ctx, capabilities, body, { targets: [], result_mode: null });
    if (!options) return;
    const tools = Array.isArray(allowed_tools) && allowed_tools.length > 0 ? allowed_tools : canonicalTools(capabilities);
    const version = { id: id("sv"), name: slug, description: description ?? "", status: "published", version: 1, allowed_tools: tools, capabilities, instructions_markdown: instructions_markdown ?? "", ...options };
    const skill = { id: id("skill"), workspace_id: workspace.id, owner_user_id: ctx.user.id, slug, scope_type: scope_type ?? "personal", status: "enabled", enabled_version: version, latest_version: version };
    state.skills.push(skill);
    ctx.json(201, toAuthoringResult(skill, version));
  });

  // 게시 전 정의를 문서 하나에 저장 없이 적용해 본다(document#148·ai#123). run_id는 한 번만 쓸 수 있다(재사용 409).
  // 지침 표식으로 오류를 재현한다: #테스트불가 → 503 SKILL_TEST_RUN_UNAVAILABLE, #AI장애 → 503 SKILL_AI_UNAVAILABLE, #지연 → 3초 대기.
  router.post("/api/workspaces/:wid/skills/test-run", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const runId = ctx.url.searchParams.get("run_id") ?? `skill_test_${id("run")}`;
    if (!/^[a-zA-Z0-9:_-]{1,120}$/.test(runId)) return error(ctx, 400, "run_id 형식이 올바르지 않습니다.", "INVALID_REQUEST");
    if (usedTestRunIds.has(runId)) return error(ctx, 409, "이미 사용한 run_id입니다.");
    usedTestRunIds.add(runId);
    const body = await ctx.body();
    const { name, description, instructions_markdown, document_id, target } = body;
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
    const hasRequired = [name, description, instructions_markdown, document_id].every((value) => typeof value === "string" && value.trim());
    if (!hasRequired || capabilities.length === 0) return error(ctx, 400, "요청 형식이 올바르지 않습니다.", "INVALID_REQUEST");
    const doc = findDocument(workspace.id, document_id);
    if (!doc) return error(ctx, 404, "문서를 찾을 수 없습니다.", "DOCUMENT_NOT_FOUND");
    if (!isMarkdownDocument(doc) || typeof doc.markdown !== "string") return error(ctx, 400, "Markdown 문서만 테스트할 수 있습니다.", "INVALID_REQUEST");
    const markdown = typeof body.markdown === "string" ? body.markdown : doc.markdown;
    if (target != null) {
      const lineCount = markdown.split("\n").length;
      const isValidType = ["selection", "current_section", "whole_document"].includes(target.type);
      if (!isValidType || !(target.start_line >= 1) || target.end_line < target.start_line || target.end_line > lineCount) {
        return error(ctx, 400, `적용 범위가 문서 줄 수(${lineCount})를 벗어났습니다.`, "INVALID_REQUEST");
      }
    }
    if (capabilities.includes("folder-organize")) {
      return error(ctx, 400, "이 종류의 Skill은 테스트 실행을 지원하지 않습니다. 문서 작성·수정·템플릿 Skill만 테스트할 수 있습니다.", "SKILL_TEST_RUN_UNSUPPORTED");
    }
    if (/#테스트불가/.test(instructions_markdown)) return error(ctx, 503, "Skill 테스트 실행을 아직 사용할 수 없습니다.", "SKILL_TEST_RUN_UNAVAILABLE");
    if (/#AI장애/.test(instructions_markdown)) return error(ctx, 503, "AI 서버를 사용할 수 없습니다.", "SKILL_AI_UNAVAILABLE");
    await sleep(/#지연/.test(instructions_markdown) ? 3000 : 600);
    const issues = detectSkillIssues(instructions_markdown);
    if (issues.length > 0) return ctx.json(200, { run_id: runId, status: "blocked", changes: [], untouched_sections: [], result_markdown: null, issues });
    ctx.json(200, { run_id: runId, ...testRunResult({ name, description, capabilities }, markdown, target) });
  });

  router.patch("/api/workspaces/:wid/skills/:skillId", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const skill = findSkill(ctx, workspace);
    if (!skill) return;
    const body = await ctx.body();
    // 실제 백엔드처럼 세 필드를 모두 필수로 검증한다(SkillUpdateRequest @NotBlank).
    if (!["name", "description", "instructions_markdown"].every((key) => typeof body[key] === "string" && body[key].trim())) {
      return error(ctx, 400, "요청 값이 올바르지 않습니다.");
    }
    // 실제 백엔드처럼 name으로 커맨드(slug)를 바꾸고, 다른 스킬과 겹치면 409로 막는다.
    if (state.skills.some((item) => item.workspace_id === workspace.id && item.id !== skill.id && item.slug === body.name)) {
      return error(ctx, 409, "같은 이름의 스킬이 이미 있습니다.");
    }
    const base = skill.latest_version ?? skill.enabled_version;
    // 실제 AI는 고친 지침으로 capabilities를 다시 분류한다. 지침 표식으로 재현한다: #새문서 → document-create, #고치기 → document-edit.
    const reclassified = /#새문서/.test(body.instructions_markdown) ? ["document-create"]
      : /#고치기/.test(body.instructions_markdown) ? ["document-edit"] : base?.capabilities ?? [];
    // 생략한 값은 이어받는다. 필드가 생기기 전 문서 Skill(targets 없음)은 두 대상 모두로 읽는다.
    const inherited = { targets: base?.targets?.length ? base.targets : TARGET_ORDER, result_mode: base?.result_mode ?? null };
    const options = executionOptions(ctx, reclassified, body, inherited);
    if (!options) return;
    const version = { ...base, capabilities: reclassified, id: id("sv"), version: (base?.version ?? 0) + 1, name: body.name, description: body.description, instructions_markdown: body.instructions_markdown, ...options };
    skill.slug = body.name;
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
