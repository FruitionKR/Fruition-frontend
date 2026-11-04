// document-svc PDF 직접 업로드(start·parts·조각 PUT·complete·abort, Fruition-document docs/api/documents/management.md).
// S3 대신 mock 자신의 /api/mock-storage/document-uploads 경로가 조각을 받는다(next rewrite로 같은 출처).
// X-Fruition-Import-Id가 있으면 시작 때 열린 가져오기 세션인지 보고 ticket에 묶는다. 확정에도 같은 헤더가 와야 하고,
// 확정한 PDF는 그 세션 문서(origin=notion_import)가 된다. 100MB·저장 공간·Idempotency-Key는 일반 업로드와 같다.
//
// 환경 변수: MOCK_DOCUMENT_PART_SIZE(조각 크기, 기본 64 MiB)
import { randomUUID } from "node:crypto";
import { error, hash, id, now, requireFolderWrite, requireWorkspace, state, toDocumentItem } from "../state.mjs";
import { uploadRejection } from "../lib/limits.mjs";
import { rememberIdempotent, replayIdempotent, useImportSession } from "./imports.mjs";

const PDF_MAX_BYTES = 100 * 1024 * 1024;
const MAX_PARTS_PER_REQUEST = 32;
const UPLOAD_PATH = "/api/mock-storage/document-uploads";
const partSize = () => Math.max(1, Number(process.env.MOCK_DOCUMENT_PART_SIZE ?? 64 * 1024 * 1024));

// ticket → 진행 중인 업로드
const uploads = new Map();

function uploadFor(ctx, workspace, ticket) {
  const upload = ticket ? uploads.get(ticket) : null;
  if (!upload || upload.workspaceId !== workspace.id || upload.userId !== ctx.user.id) {
    error(ctx, 400, "업로드 확인 정보가 만료되었거나 올바르지 않습니다.", "DOCUMENT_UPLOAD_REJECTED");
    return null;
  }
  return upload;
}

/** 같은 부모의 같은 이름이면 `이름 (2).pdf`처럼 번호를 붙인다(서버 uniqueUploadFilename). */
function uniqueFilename(workspaceId, folderId, filename) {
  const normalize = (value) => value.trim().normalize("NFC").toLowerCase();
  const taken = new Set([
    ...state.documents.filter((doc) => doc.workspace_id === workspaceId && !doc.deleted_at && (doc.folder_id ?? null) === folderId).map((doc) => normalize(doc.filename)),
    ...state.folders.filter((folder) => folder.workspace_id === workspaceId && !folder.deleted_at && (folder.parent_folder_id ?? null) === folderId).map((folder) => normalize(folder.name))
  ]);
  const base = filename.replace(/\.pdf$/i, "");
  let candidate = filename;
  for (let number = 2; taken.has(normalize(candidate)); number += 1) candidate = `${base} (${number}).pdf`;
  return candidate;
}

export function registerDocumentUploadRoutes(router) {
  router.post("/api/workspaces/:wid/documents/uploads", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { filename, size, folder_id: folderId = null } = await ctx.body();
    if (typeof filename !== "string" || !/\.pdf$/i.test(filename) || /[/\\]/.test(filename) || filename.length > 255) {
      return error(ctx, 400, "올바른 PDF 파일명이 필요합니다.", "DOCUMENT_UPLOAD_REJECTED");
    }
    if (!Number.isSafeInteger(size) || size <= 0) return error(ctx, 400, "PDF 크기는 0보다 커야 합니다.", "DOCUMENT_UPLOAD_REJECTED");
    if (size > PDF_MAX_BYTES) return error(ctx, 413, "PDF 파일은 100MB 이하로 올려 주세요.", "FILE_TOO_LARGE");
    if (!requireFolderWrite(ctx, workspace.id, folderId)) return;
    // 시작 때는 세션만 확인하고 항목은 확정 때 센다.
    const session = useImportSession(ctx, workspace, 0);
    if (session === false) return;
    const rejection = uploadRejection(ctx.user.id, size);
    if (rejection) return error(ctx, rejection.status, rejection.message, rejection.code);
    const ticket = `dut_${randomUUID().replaceAll("-", "")}`;
    const partBytes = partSize();
    const partCount = Math.ceil(size / partBytes);
    uploads.set(ticket, { workspaceId: workspace.id, userId: ctx.user.id, filename: filename.normalize("NFC"), size, folderId, importId: session?.id ?? "", partBytes, partCount, parts: new Map() });
    ctx.json(200, { ticket, part_size: partBytes, part_count: partCount });
  });

  router.post("/api/workspaces/:wid/documents/uploads/parts", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const body = await ctx.body();
    const upload = uploadFor(ctx, workspace, body.ticket);
    if (!upload) return;
    const first = Number(body.first_part);
    const count = Number(body.count);
    if (!Number.isInteger(first) || !Number.isInteger(count) || first < 1 || count < 1 || count > MAX_PARTS_PER_REQUEST || first + count - 1 > upload.partCount) {
      return error(ctx, 400, "조각 번호가 올바르지 않습니다.", "DOCUMENT_UPLOAD_REJECTED");
    }
    ctx.json(200, { parts: Array.from({ length: count }, (_, index) => ({ part_number: first + index, url: `${UPLOAD_PATH}/${body.ticket}/${first + index}` })) });
  });

  // presigned PUT 대역. 인증 헤더 없이 ticket으로만 받는다.
  router.put(`${UPLOAD_PATH}/:ticket/:part`, async (ctx) => {
    const upload = uploads.get(ctx.params.ticket);
    const part = Number(ctx.params.part);
    if (!upload || !Number.isInteger(part) || part < 1 || part > upload.partCount) return ctx.json(403, { error: { message: "AccessDenied" } });
    upload.parts.set(part, await ctx.raw());
    ctx.json(200, {}, { ETag: `"${randomUUID()}"` });
  }, { open: true });

  router.post("/api/workspaces/:wid/documents/uploads/abort", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const body = await ctx.body();
    if (!uploadFor(ctx, workspace, body.ticket)) return;
    uploads.delete(body.ticket);
    ctx.json(204, null);
  });

  router.post("/api/workspaces/:wid/documents/uploads/complete", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const scope = `POST:/api/workspaces/${workspace.id}/documents/uploads/complete`;
    if (!ctx.req.headers["idempotency-key"]) return error(ctx, 400, "Idempotency-Key가 필요합니다.", "INVALID_IDEMPOTENCY_KEY");
    if (replayIdempotent(ctx, scope)) return;
    const body = await ctx.body();
    const upload = uploadFor(ctx, workspace, body.ticket);
    if (!upload) return;
    if ((ctx.req.headers["x-fruition-import-id"] ?? "") !== upload.importId) {
      return error(ctx, 400, "가져오기 세션이 없거나 만료·완료되었습니다. 가져오기를 다시 시작해 주세요.", "IMPORT_INVALID");
    }
    const session = useImportSession(ctx, workspace);
    if (session === false) return;
    const chunks = [];
    for (let part = 1; part <= upload.partCount; part += 1) {
      const chunk = upload.parts.get(part);
      if (!chunk) return error(ctx, 409, "전송되지 않은 조각이 있습니다.", "DOCUMENT_UPLOAD_REJECTED");
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks);
    if (content.length !== upload.size) return error(ctx, 400, "업로드한 파일 정보가 일치하지 않습니다.", "DOCUMENT_UPLOAD_REJECTED");
    if (content.subarray(0, 5).toString("latin1") !== "%PDF-") return error(ctx, 415, "PDF 파일 내용이 올바르지 않습니다.", "DOCUMENT_UPLOAD_REJECTED");
    const rejection = uploadRejection(ctx.user.id, content.length);
    if (rejection) return error(ctx, rejection.status, rejection.message, rejection.code);
    uploads.delete(body.ticket);
    const filename = uniqueFilename(workspace.id, upload.folderId, upload.filename);
    const timestamp = now();
    const doc = {
      id: id("doc"), workspace_id: workspace.id, filename, mime_type: "application/pdf", byte_size: content.length, status: "uploaded",
      folder_id: upload.folderId, sort_order: 0, source_uri: `mock://uploads/${filename}`, uploaded_at: timestamp, updated_at: timestamp,
      document_role: "ORIGINAL", markdown: null, content, owner_user_id: ctx.user.id, permission: null,
      current_version: 1, edit_revision: 1,
      versions: [{ version: 1, content_hash: hash(content.toString("latin1")), created_by: ctx.user.id, created_at: timestamp, markdown: null }],
      ...(session ? { origin: "notion_import", import_id: session.id } : {})
    };
    state.documents.push(doc);
    if (session) session.document_ids.push(doc.id);
    const response = toDocumentItem(doc);
    rememberIdempotent(ctx, scope, 201, response);
    ctx.json(201, response);
  });
}
