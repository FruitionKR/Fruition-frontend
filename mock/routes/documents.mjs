// document-svc(8080) 문서 라우트: 목록·업로드·상세·삭제·이름 변경·원본·원본 block·본문 저장·ingest·변환·편집 잠금.
import { state, now, id, hash, error, requireWorkspace, findDocument, toDocumentItem, isMarkdownDocument, isSkillReference, SKILL_REFERENCE_ORIGIN, sleep } from "../state.mjs";
import { startConvert, startIngest } from "../pipeline.mjs";
import { sha256 } from "../lib/sourceBlocks.mjs";

const MIME_BY_EXTENSION = { md: "text/markdown", markdown: "text/markdown", txt: "text/plain", pdf: "application/pdf" };
// 편집기 이미지 첨부 계약: 본문의 attachment://<uuid> placeholder와 attachment_<uuid> file part
const ATTACHMENT_PLACEHOLDER = /attachment:\/\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
// 업로드 전송 시간 흉내: 기본 1초 + 200KB당 1초, 최대 12초. MOCK_UPLOAD_DELAY_MS로 고정할 수 있다.
const UPLOAD_BYTES_PER_MS = 200;
const UPLOAD_BASE_DELAY_MS = 1_000;
const UPLOAD_MAX_DELAY_MS = 12_000;
function uploadDelay(byteSize) {
  if (process.env.MOCK_UPLOAD_DELAY_MS !== undefined) return Number(process.env.MOCK_UPLOAD_DELAY_MS);
  return Math.min(UPLOAD_MAX_DELAY_MS, UPLOAD_BASE_DELAY_MS + Math.round(byteSize / UPLOAD_BYTES_PER_MS));
}

function requireDocument(ctx, workspace) {
  const doc = findDocument(workspace.id, ctx.params.id);
  if (!doc) error(ctx, 404, "문서를 찾을 수 없습니다.");
  return doc;
}

// 편집 잠금 TTL. 프론트는 남은 TTL의 1/3마다 heartbeat를 보낸다.
const EDIT_LOCK_TTL_MS = 60_000;

/** 만료되지 않은 잠금만 돌려준다. 만료된 잠금은 지운다. */
function activeEditLock(documentId) {
  const lock = state.editLocks.get(documentId);
  if (lock && Date.parse(lock.expires_at) > Date.now()) return lock;
  state.editLocks.delete(documentId);
  return null;
}

/** 응답 시점에 남은 TTL(ttl_ms)을 붙인다. 프론트는 시계 차이와 무관하게 이 값으로 만료를 판단한다. */
function withLockTtl(lock) {
  return { ...lock, ttl_ms: Math.max(0, Date.parse(lock.expires_at) - Date.now()) };
}

function isTextDocument(doc) {
  return doc.document_role === "EDITABLE" || doc.mime_type.startsWith("text/");
}

function saveVersion(doc, markdown, createdBy) {
  const buffer = Buffer.from(markdown, "utf8");
  doc.current_version += 1;
  doc.edit_revision = doc.current_version;
  doc.markdown = markdown;
  doc.content = buffer;
  doc.byte_size = buffer.length;
  doc.updated_at = now();
  if (doc.status === "completed") doc.needs_reingest = true;
  const contentHash = hash(markdown);
  doc.versions.push({ version: doc.current_version, content_hash: contentHash, created_by: createdBy, created_at: doc.updated_at, markdown });
  return { document_id: doc.id, current_version: doc.current_version, content_hash: contentHash, updated_at: doc.updated_at, changed: true };
}

/**
 * 서버 DocumentEditingRules.uniqueUploadFilename 흉내: 같은 부모에 같은 이름(문서·폴더, 대소문자 무시)이 있으면
 * `이름 (2).pdf`처럼 번호를 붙인다. 업로드는 이름 중복으로 거절하지 않는다.
 */
function uniqueUploadFilename(workspaceId, folderId, filename, isReference = false) {
  const normalize = (value) => value.trim().normalize("NFC").toLowerCase();
  // 스킬 참고 문서는 트리 이름 공간 밖이라 참고 문서끼리만 워크스페이스 단위로 비교한다.
  const taken = new Set(isReference
    ? state.documents.filter((doc) => doc.workspace_id === workspaceId && !doc.deleted_at && isSkillReference(doc)).map((doc) => normalize(doc.filename))
    : [
      ...state.documents.filter((doc) => doc.workspace_id === workspaceId && !doc.deleted_at && !isSkillReference(doc) && (doc.folder_id ?? null) === folderId).map((doc) => normalize(doc.filename)),
      ...state.folders.filter((folder) => folder.workspace_id === workspaceId && !folder.deleted_at && (folder.parent_folder_id ?? null) === folderId).map((folder) => normalize(folder.name))
    ]);
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  let candidate = filename;
  for (let number = 2; taken.has(normalize(candidate)); number += 1) candidate = `${base} (${number})${extension}`;
  return candidate;
}

export function registerDocumentRoutes(router) {
  router.get("/api/workspaces/:wid/documents", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    // 스킬 참고 문서는 기본 목록에서 빠지고 origin=skill_reference로만 최근 업로드 순으로 조회한다.
    const origin = ctx.query.get("origin");
    if (origin !== null && origin !== SKILL_REFERENCE_ORIGIN) return error(ctx, 400, "허용하지 않는 origin입니다.", "INVALID_DOCUMENT_ORIGIN");
    const documents = state.documents.filter((doc) => doc.workspace_id === workspace.id && !doc.deleted_at && isSkillReference(doc) === (origin !== null));
    if (origin !== null) documents.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
    ctx.json(200, { documents: documents.map(toDocumentItem) });
  });

  router.post("/api/workspaces/:wid/documents", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { file, folder_id: folderId = null } = await ctx.body();
    const origin = ctx.query.get("origin");
    const isReference = origin === SKILL_REFERENCE_ORIGIN;
    if (!file?.buffer) return error(ctx, 400, "업로드할 파일이 필요합니다.");
    if (origin !== null && (!isReference || folderId)) return error(ctx, 400, "허용하지 않는 origin이거나 참고 문서에 폴더를 지정했습니다.", "INVALID_DOCUMENT_ORIGIN");
    if (folderId && !state.folders.some((folder) => folder.id === folderId && folder.workspace_id === workspace.id && !folder.deleted_at)) return error(ctx, 404, "폴더를 찾을 수 없습니다.");
    let requestedName = file.name.normalize("NFC");
    const extension = requestedName.split(".").pop()?.toLowerCase() ?? "";
    if (!MIME_BY_EXTENSION[extension]) return error(ctx, 415, "md, txt, pdf 파일만 업로드할 수 있습니다.");
    if (isReference && extension === "pdf") return error(ctx, 415, "스킬 참고 문서는 Markdown·txt만 올릴 수 있습니다.", "UNSUPPORTED_FILE_TYPE");
    // 서버처럼 참고 문서 txt는 .md 이름의 편집 가능 Markdown으로 저장한다.
    if (isReference && extension === "txt") requestedName = requestedName.replace(/\.txt$/i, ".md");
    const mime = isReference ? "text/markdown" : MIME_BY_EXTENSION[extension];
    const isMarkdown = mime === "text/markdown";
    const text = isMarkdown ? file.buffer.toString("utf8") : null;
    // 실제 업로드처럼 전송이 끝날 때까지 응답을 미룬다. 프론트는 그동안 "업로드 중" 자리표시 행을 보여준다.
    await sleep(uploadDelay(file.buffer.length));
    // 동시 업로드도 서로 다른 번호를 받도록 전송이 끝난 시점에 이름을 정한다.
    const filename = uniqueUploadFilename(workspace.id, folderId, requestedName, isReference);
    const timestamp = now();
    const doc = {
      id: id("doc"), workspace_id: workspace.id, filename, mime_type: mime, byte_size: file.buffer.length, status: "uploaded", folder_id: folderId, sort_order: 0,
      ...(isReference ? { origin: SKILL_REFERENCE_ORIGIN } : {}),
      source_uri: `mock://uploads/${filename}`, uploaded_at: timestamp, updated_at: timestamp,
      document_role: isMarkdown ? "EDITABLE" : "ORIGINAL", markdown: text, content: file.buffer,
      current_version: 1, edit_revision: 1,
      versions: [{ version: 1, content_hash: hash(file.buffer.toString("utf8")), created_by: ctx.user.id, created_at: timestamp, markdown: text }]
    };
    state.documents.push(doc);
    ctx.json(201, toDocumentItem(doc));
  });

  router.get("/api/workspaces/:wid/documents/:id", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    ctx.json(200, { ...toDocumentItem(doc), markdown: isMarkdownDocument(doc) ? doc.markdown : null, current_version: doc.current_version, edit_revision: doc.edit_revision, updated_at: doc.updated_at });
  });

  router.delete("/api/workspaces/:wid/documents/:id", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    const { base_version } = await ctx.body();
    if (base_version !== doc.current_version) return error(ctx, 409, "문서가 다른 곳에서 변경되었습니다. 새로고침 후 다시 시도해주세요.");
    doc.deleted_at = now();
    ctx.json(204);
  });

  router.patch("/api/workspaces/:wid/documents/:id/rename", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    const { display_name, base_version } = await ctx.body();
    if (base_version !== doc.current_version) return error(ctx, 409, "문서가 다른 곳에서 변경되었습니다.");
    if (typeof display_name !== "string" || !display_name.trim()) return error(ctx, 400, "문서 이름을 입력해주세요.");
    const extensionIndex = doc.filename.lastIndexOf(".");
    const extension = extensionIndex > 0 ? doc.filename.slice(extensionIndex) : "";
    doc.filename = `${display_name.trim()}${extension}`;
    doc.updated_at = now();
    ctx.json(200, toDocumentItem(doc));
  });

  router.get("/api/workspaces/:wid/documents/:id/original", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    const contentType = isTextDocument(doc) ? `${doc.mime_type}; charset=utf-8` : doc.mime_type;
    ctx.bytes(200, doc.content, contentType);
  });

  // 근거 하이라이트용 원본 block. 마지막 ingest 스냅샷 기준이며 현재 본문과 해시가 다르면 is_stale이다.
  router.get("/api/workspaces/:wid/documents/:id/blocks", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    const snapshot = doc.source_snapshot ?? null;
    const currentContentHash = typeof doc.markdown === "string" ? sha256(doc.markdown) : null;
    ctx.json(200, {
      document_id: doc.id,
      source_content_hash: snapshot?.content_hash ?? null,
      current_content_hash: currentContentHash,
      is_stale: snapshot ? snapshot.content_hash !== currentContentHash : null,
      blocks: snapshot?.blocks ?? []
    });
  });

  router.put("/api/workspaces/:wid/documents/:id/content", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    const body = await ctx.body();
    // 이미지 포함 저장: metadata JSON + attachment_<uuid> file part. placeholder를 관리 경로로 치환해 돌려준다.
    if (typeof body.metadata === "string") {
      let metadata;
      try { metadata = JSON.parse(body.metadata); } catch { return error(ctx, 400, "metadata JSON이 올바르지 않습니다."); }
      if (typeof metadata.markdown !== "string" || !(Number(metadata.base_version) >= 1)) return error(ctx, 400, "metadata에는 markdown과 1 이상의 base_version이 필요합니다.");
      if (Number(metadata.base_version) !== doc.edit_revision) return error(ctx, 409, "다른 편집 내용이 먼저 저장되었습니다.");
      const placeholders = [...new Set([...metadata.markdown.matchAll(ATTACHMENT_PLACEHOLDER)].map((match) => match[1].toLowerCase()))];
      const files = Object.entries(body).filter(([key]) => key.startsWith("attachment_")).map(([key, file]) => [key.slice("attachment_".length).toLowerCase(), file]);
      const fileIds = files.map(([id]) => id);
      if (placeholders.length !== fileIds.length || placeholders.some((id) => !fileIds.includes(id))) return error(ctx, 400, "placeholder와 이미지 file part가 일치하지 않습니다.");
      if (files.length > 20) return error(ctx, 413, "저장당 이미지는 20개까지입니다.");
      for (const [, file] of files) {
        if (!ALLOWED_IMAGE_TYPES.has(file?.type)) return error(ctx, 415, "PNG, JPEG, WebP, GIF만 허용합니다.");
        if (!file.buffer?.length) return error(ctx, 400, "빈 이미지 파일입니다.");
        if (file.buffer.length > 10 * 1024 * 1024) return error(ctx, 413, "이미지당 10MB를 넘을 수 없습니다.");
      }
      const attachments = files.map(([attachmentId, file]) => {
        const asset = { id: id("asset"), workspace_id: workspace.id, content_type: file.type, buffer: file.buffer, created_at: now() };
        state.assets.push(asset);
        return { attachment_id: attachmentId, asset_id: asset.id, content_path: `/api/workspaces/${workspace.id}/assets/${asset.id}/content` };
      });
      const pathById = new Map(attachments.map((entry) => [entry.attachment_id, entry.content_path]));
      const markdown = metadata.markdown.replace(ATTACHMENT_PLACEHOLDER, (_whole, attachmentId) => pathById.get(attachmentId.toLowerCase()));
      return ctx.json(200, { ...saveVersion(doc, markdown, ctx.user.id), markdown, attachments });
    }
    // 프론트는 CRLF 변환을 피하려고 markdown을 file part(Blob)로 보낸다. 문자열·파일 둘 다 받는다.
    const markdown = typeof body.markdown === "string" ? body.markdown : body.markdown?.buffer?.toString("utf8");
    const { base_revision } = body;
    if (typeof markdown !== "string") return error(ctx, 400, "markdown 본문이 필요합니다.");
    if (Number(base_revision) !== doc.edit_revision) return error(ctx, 409, "다른 편집 내용이 먼저 저장되었습니다.");
    if (markdown === doc.markdown) {
      return ctx.json(200, { document_id: doc.id, current_version: doc.current_version, content_hash: hash(markdown), updated_at: doc.updated_at, changed: false });
    }
    ctx.json(200, saveVersion(doc, markdown, ctx.user.id));
  });

  // 관리 이미지 조회 (REQ-005): 워크스페이스 멤버만. 다른 워크스페이스 asset은 404.
  router.get("/api/workspaces/:wid/assets/:id/content", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const asset = state.assets.find((item) => item.id === ctx.params.id && item.workspace_id === workspace.id);
    if (!asset) return error(ctx, 404, "이미지를 찾을 수 없습니다.");
    ctx.bytes(200, asset.buffer, asset.content_type);
  });

  router.post("/api/workspaces/:wid/documents/:id/ingest", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    if (doc.document_role !== "EDITABLE") return error(ctx, 400, "편집 가능한 Markdown 문서만 분석할 수 있습니다.");
    if (isSkillReference(doc)) return error(ctx, 400, "스킬 참고 문서는 위키에 편입할 수 없습니다.");
    if (doc.status === "processing") return error(ctx, 409, "이미 분석 중인 문서입니다.");
    startIngest(workspace, doc);
    ctx.json(202, { document_id: doc.id, status: "processing" });
  });

  router.post("/api/workspaces/:wid/documents/:id/convert-markdown", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    if (doc.document_role === "EDITABLE") return error(ctx, 400, "이미 Markdown 문서입니다.");
    ctx.json(202, startConvert(workspace, doc));
  });

  // 편집 잠금: 비었거나 만료됐거나 본인 보유면 획득, 타인 보유면 423(보유자 정보 포함).
  router.post("/api/workspaces/:wid/documents/:id/edit-lock", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    const current = activeEditLock(doc.id);
    if (current && current.holder_user_id !== ctx.user.id) return ctx.json(423, withLockTtl(current));
    const lock = {
      holder_user_id: ctx.user.id,
      holder_display_name: ctx.user.display_name,
      expires_at: new Date(Date.now() + EDIT_LOCK_TTL_MS).toISOString()
    };
    state.editLocks.set(doc.id, lock);
    ctx.json(200, withLockTtl(lock));
  });

  // heartbeat: 본인이 보유한 유효 잠금만 연장한다. 만료·타인 보유는 구분 없이 409.
  router.post("/api/workspaces/:wid/documents/:id/edit-lock/heartbeat", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    const current = activeEditLock(doc.id);
    if (!current || current.holder_user_id !== ctx.user.id) return error(ctx, 409, "편집 잠금을 보유하고 있지 않습니다.");
    const lock = { ...current, expires_at: new Date(Date.now() + EDIT_LOCK_TTL_MS).toISOString() };
    state.editLocks.set(doc.id, lock);
    ctx.json(200, withLockTtl(lock));
  });

  // 해제: 본인 잠금만 지우며 멱등이다.
  router.delete("/api/workspaces/:wid/documents/:id/edit-lock", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    if (state.editLocks.get(ctx.params.id)?.holder_user_id === ctx.user.id) state.editLocks.delete(ctx.params.id);
    ctx.json(204, null);
  });
}
