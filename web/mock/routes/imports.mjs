// document-svc(8080) Notion 가져오기 라우트: 가져오기 세션·Markdown 문서 생성(JSON)·완료·편입 비용·일괄 편입.
// 가져오기 쓰기 요청은 X-Fruition-Import-Id 헤더로 세션에 묶이고 저장 용량을 검사한다. item 수 상한은 없다.
import { randomUUID } from "node:crypto";
import { state, now, id, hash, error, requireWorkspace, toDocumentItem, isSkillReference } from "../state.mjs";
import { storageOf, uploadRejection } from "../lib/limits.mjs";
import { startIngest } from "../pipeline.mjs";

const IMPORT_TTL_MS = 24 * 60 * 60 * 1000;
const MARKDOWN_MAX_BYTES = 5 * 1024 * 1024;
// 편입 비용 흉내: 문서 하나에 0.02 USD, 30원(= 30,000 milli-KRW). MOCK_INGEST_ESTIMATE_KRW_MILLI로 바꾼다.
const INGEST_COST_PER_DOCUMENT_USD = 0.02;
const INGEST_COST_PER_DOCUMENT_KRW_MILLI = Number(process.env.MOCK_INGEST_ESTIMATE_KRW_MILLI ?? 30_000);
// 백엔드처럼 편입 요청 한 번에 20개까지 큐에 넣는다.
const INGEST_BATCH = 20;

// import_id → 세션
const imports = new Map();
// 멱등 키 재생: `${userId}:${scope}:${key}` → { status, body }
const idempotent = new Map();

function toSession(session) {
  return { import_id: session.id, status: session.status, expires_at: session.expires_at, max_items: null, document_count: session.document_ids.length, item_count: session.item_count };
}

/**
 * 요청에 X-Fruition-Import-Id가 있으면 열린 세션인지 확인하고 item을 센다. 헤더가 없으면 null(일반 요청).
 * 거절했으면 응답을 쓰고 false를 돌려준다.
 */
export function useImportSession(ctx, workspace, items = 1) {
  const importId = ctx.req.headers["x-fruition-import-id"];
  if (!importId) return null;
  const session = imports.get(importId);
  if (!session || session.workspace_id !== workspace.id || session.user_id !== ctx.user.id || session.status !== "open" || Date.parse(session.expires_at) < Date.now()) {
    error(ctx, 400, "가져오기 세션이 없거나 이미 끝났습니다.", "IMPORT_INVALID");
    return false;
  }
  session.used_items += items;
  return session;
}

/** 같은 Idempotency-Key 재요청이면 처음 응답을 그대로 돌려주고 true. */
export function replayIdempotent(ctx, scope) {
  const key = ctx.req.headers["idempotency-key"];
  const stored = key ? idempotent.get(`${ctx.user.id}:${scope}:${key}`) : null;
  if (!stored) return false;
  ctx.json(stored.status, stored.body);
  return true;
}

export function rememberIdempotent(ctx, scope, status, body) {
  const key = ctx.req.headers["idempotency-key"];
  if (key) idempotent.set(`${ctx.user.id}:${scope}:${key}`, { status, body });
}

function requireImport(ctx, workspace) {
  const session = imports.get(ctx.params.importId);
  if (!session || session.workspace_id !== workspace.id || session.user_id !== ctx.user.id) {
    error(ctx, 404, "가져오기를 찾을 수 없습니다.", "IMPORT_NOT_FOUND");
    return null;
  }
  return session;
}

function importedDocuments(session) {
  return state.documents.filter((doc) => session.document_ids.includes(doc.id) && !doc.deleted_at);
}

export function registerImportRoutes(router) {
  router.post("/api/workspaces/:wid/imports", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { source, item_count: itemCount, total_bytes: totalBytes } = await ctx.body();
    if (source !== "notion") return error(ctx, 400, "source는 notion이어야 합니다.", "INVALID_REQUEST");
    if (!Number.isInteger(itemCount) || itemCount < 0 || !Number.isFinite(totalBytes) || totalBytes < 0) return error(ctx, 400, "item_count와 total_bytes가 필요합니다.", "INVALID_REQUEST");
    const rejection = uploadRejection(ctx.user.id, totalBytes);
    if (rejection) return error(ctx, rejection.status, rejection.message, rejection.code);
    const session = {
      id: `imp_${randomUUID().slice(0, 12)}`, workspace_id: workspace.id, user_id: ctx.user.id, source, status: "open",
      item_count: itemCount, total_bytes: totalBytes, used_items: 0, document_ids: [], created_at: now(),
      expires_at: new Date(Date.now() + IMPORT_TTL_MS).toISOString(), result: null
    };
    imports.set(session.id, session);
    const quota = storageOf(ctx.user.id);
    ctx.json(201, { ...toSession(session), quota: { used_bytes: quota.used_bytes, limit_bytes: quota.limit_bytes } });
  });

  router.get("/api/workspaces/:wid/imports/:importId", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const session = requireImport(ctx, workspace);
    if (session) ctx.json(200, { ...toSession(session), result: session.result });
  });

  router.post("/api/workspaces/:wid/imports/:importId/complete", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const session = requireImport(ctx, workspace);
    if (!session) return;
    const { created = 0, failed = 0, skipped = 0 } = await ctx.body();
    if ([created, failed, skipped].some((value) => typeof value !== "number" || value < 0)) return error(ctx, 400, "개수는 0 이상이어야 합니다.", "INVALID_REQUEST");
    // 이미 완료한 세션은 처음 결과를 그대로 돌려준다.
    if (session.status !== "completed") {
      session.status = "completed";
      session.result = { created, failed, skipped };
    }
    ctx.json(200, { import_id: session.id, status: session.status, document_count: importedDocuments(session).length });
  });

  router.get("/api/workspaces/:wid/imports/:importId/ingest-estimate", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const session = requireImport(ctx, workspace);
    if (!session) return;
    // 아직 편입을 요청하지 않은 문서만 센다. estimated_credits는 milli-KRW다.
    const count = importedDocuments(session).filter((doc) => !doc.import_ingest_requested).length;
    ctx.json(200, {
      document_count: count,
      estimated_cost_usd: Math.round(count * INGEST_COST_PER_DOCUMENT_USD * 100) / 100,
      estimated_credits: count * INGEST_COST_PER_DOCUMENT_KRW_MILLI
    });
  });

  router.post("/api/workspaces/:wid/imports/:importId/ingest", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const session = requireImport(ctx, workspace);
    if (!session) return;
    const { document_ids: documentIds } = await ctx.body();
    const documents = importedDocuments(session);
    if (documentIds !== undefined) {
      const valid = Array.isArray(documentIds) && documentIds.length > 0 && documentIds.length <= INGEST_BATCH
        && documentIds.every((documentId) => documents.some((doc) => doc.id === documentId));
      if (!valid) return error(ctx, 400, "document_ids는 이 가져오기의 문서 1~20개여야 합니다.", "INVALID_REQUEST");
    }
    // MOCK_IMPORT_INGEST_LIMIT_AFTER=N이면 N개를 넣은 뒤 AI 사용 한도(429)를 흉내 낸다.
    const limitAfter = Number(process.env.MOCK_IMPORT_INGEST_LIMIT_AFTER ?? Infinity);
    const requestedSoFar = documents.filter((doc) => doc.import_ingest_requested).length;
    const pending = documents.filter((doc) => !doc.import_ingest_requested && (documentIds === undefined || documentIds.includes(doc.id)));
    if (pending.length > 0 && requestedSoFar >= limitAfter) {
      return error(ctx, 429, "AI 사용 한도를 넘었습니다.", "AI_USAGE_LIMIT_EXCEEDED");
    }
    const batch = pending.slice(0, INGEST_BATCH);
    for (const doc of batch) {
      doc.import_ingest_requested = true;
      if (doc.status !== "processing") startIngest(workspace, doc);
    }
    const remaining = documents.filter((doc) => !doc.import_ingest_requested).length;
    ctx.json(202, { queued: batch.length, remaining });
  });

  // 일반 Markdown 문서 생성(JSON). 가져오기 헤더가 있으면 세션에 묶고 item 수를 센다.
  router.post("/api/workspaces/:wid/documents/markdown", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const scope = `POST:/api/workspaces/${workspace.id}/documents/markdown`;
    if (!ctx.req.headers["idempotency-key"]) return error(ctx, 400, "Idempotency-Key가 필요합니다.", "INVALID_IDEMPOTENCY_KEY");
    if (replayIdempotent(ctx, scope)) return;
    const { display_name: displayName, markdown, folder_id: folderId = null } = await ctx.body();
    if (typeof markdown !== "string") return error(ctx, 400, "Markdown 본문은 null일 수 없습니다.", "INVALID_MARKDOWN_CONTENT");
    const buffer = Buffer.from(markdown, "utf8");
    if (buffer.length > MARKDOWN_MAX_BYTES) return error(ctx, 413, "Markdown 본문은 UTF-8 기준 5MB 이하여야 합니다.", "FILE_TOO_LARGE");
    if (folderId && !state.folders.some((folder) => folder.id === folderId && folder.workspace_id === workspace.id && !folder.deleted_at)) return error(ctx, 404, "폴더를 찾을 수 없습니다.");
    const session = useImportSession(ctx, workspace);
    if (session === false) return;
    const rejection = uploadRejection(ctx.user.id, buffer.length);
    if (rejection) return error(ctx, rejection.status, rejection.message, rejection.code);
    const name = typeof displayName === "string" && displayName.trim() ? displayName.trim().normalize("NFC") : "document";
    const filename = /\.md$/i.test(name) ? name : `${name}.md`;
    const timestamp = now();
    const siblings = state.documents.filter((doc) => doc.workspace_id === workspace.id && !doc.deleted_at && !isSkillReference(doc) && (doc.folder_id ?? null) === folderId);
    const folders = state.folders.filter((folder) => folder.workspace_id === workspace.id && !folder.deleted_at && (folder.parent_folder_id ?? null) === folderId);
    const sortOrder = [...siblings, ...folders].reduce((max, item) => Math.max(max, item.sort_order ?? 0), -1) + 1;
    const doc = {
      id: id("doc"), workspace_id: workspace.id, filename, mime_type: "text/markdown", byte_size: buffer.length, status: "uploaded", folder_id: folderId, sort_order: sortOrder,
      source_uri: `mock://markdown/${filename}`, uploaded_at: timestamp, updated_at: timestamp,
      document_role: "EDITABLE", markdown, content: buffer, owner_user_id: ctx.user.id, permission: null,
      current_version: 1, edit_revision: 1,
      versions: [{ version: 1, content_hash: hash(markdown), created_by: ctx.user.id, created_at: timestamp, markdown }]
    };
    state.documents.push(doc);
    if (session) session.document_ids.push(doc.id);
    const body = { ...toDocumentItem(doc), folder_id: folderId, current_version: doc.current_version };
    rememberIdempotent(ctx, scope, 201, body);
    ctx.json(201, body);
  });
}
