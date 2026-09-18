// document-svc(8080) 문서 라우트: 목록·업로드·상세·삭제·이름 변경·원본·본문 저장·버전·ingest·변환.
import { state, now, id, hash, error, requireWorkspace, findDocument, toDocumentItem, isMarkdownDocument } from "../state.mjs";
import { startConvert, startIngest } from "../pipeline.mjs";

const MIME_BY_EXTENSION = { md: "text/markdown", markdown: "text/markdown", txt: "text/plain", pdf: "application/pdf" };

function requireDocument(ctx, workspace) {
  const doc = findDocument(workspace.id, ctx.params.id);
  if (!doc) error(ctx, 404, "문서를 찾을 수 없습니다.");
  return doc;
}

function isTextDocument(doc) {
  return doc.document_role === "EDITABLE" || doc.mime_type.startsWith("text/");
}

/** LCS 기반 줄 단위 diff. 서버 계약(DiffHunk/DiffLine)에 맞춰 한 hunk로 돌려준다. */
function lineDiff(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ type: "CONTEXT", old_line: i + 1, new_line: j + 1, content: a[i] });
      i += 1; j += 1;
    } else if (j < b.length && (i >= a.length || table[i][j + 1] >= table[i + 1][j])) {
      lines.push({ type: "ADD", old_line: null, new_line: j + 1, content: b[j] });
      j += 1;
    } else {
      lines.push({ type: "DELETE", old_line: i + 1, new_line: null, content: a[i] });
      i += 1;
    }
  }
  return {
    additions: lines.filter((line) => line.type === "ADD").length,
    deletions: lines.filter((line) => line.type === "DELETE").length,
    hunks: [{ old_start: 1, old_lines: a.length, new_start: 1, new_lines: b.length, lines }]
  };
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

export function registerDocumentRoutes(router) {
  router.get("/api/workspaces/:wid/documents", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const documents = state.documents.filter((doc) => doc.workspace_id === workspace.id && !doc.deleted_at).map(toDocumentItem);
    ctx.json(200, { documents });
  });

  router.post("/api/workspaces/:wid/documents", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { file } = await ctx.body();
    if (!file?.buffer) return error(ctx, 400, "업로드할 파일이 필요합니다.");
    const filename = file.name.normalize("NFC");
    const extension = filename.split(".").pop()?.toLowerCase() ?? "";
    const mime = MIME_BY_EXTENSION[extension] ?? file.type ?? "application/octet-stream";
    if (!MIME_BY_EXTENSION[extension]) return error(ctx, 415, "md, txt, pdf 파일만 업로드할 수 있습니다.");
    const isMarkdown = mime === "text/markdown";
    const text = isMarkdown ? file.buffer.toString("utf8") : null;
    const timestamp = now();
    const doc = {
      id: id("doc"), workspace_id: workspace.id, filename, mime_type: mime, byte_size: file.buffer.length, status: "uploaded",
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

  router.put("/api/workspaces/:wid/documents/:id/content", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    const { markdown, base_revision } = await ctx.body();
    if (typeof markdown !== "string") return error(ctx, 400, "markdown 본문이 필요합니다.");
    if (Number(base_revision) !== doc.edit_revision) return error(ctx, 409, "다른 편집 내용이 먼저 저장되었습니다.");
    if (markdown === doc.markdown) {
      return ctx.json(200, { document_id: doc.id, current_version: doc.current_version, content_hash: hash(markdown), updated_at: doc.updated_at, changed: false });
    }
    ctx.json(200, saveVersion(doc, markdown, ctx.user.id));
  });

  router.get("/api/workspaces/:wid/documents/:id/versions", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    const versions = [...doc.versions].reverse().map(({ version, content_hash, created_by, created_at }) => ({ version, content_hash, created_by, created_at }));
    ctx.json(200, { document_id: doc.id, current_version: doc.current_version, versions });
  });

  router.get("/api/workspaces/:wid/documents/:id/diff", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    const from = Number(ctx.query.get("from_version"));
    const to = Number(ctx.query.get("to_version"));
    const fromVersion = doc.versions.find((item) => item.version === from);
    const toVersion = doc.versions.find((item) => item.version === to);
    if (!fromVersion || !toVersion) return error(ctx, 404, "비교할 버전을 찾을 수 없습니다.");
    ctx.json(200, { document_id: doc.id, from_version: from, to_version: to, ...lineDiff(fromVersion.markdown ?? "", toVersion.markdown ?? "") });
  });

  router.post("/api/workspaces/:wid/documents/:id/versions/:version/restore", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    const { base_version } = await ctx.body();
    if (base_version !== doc.current_version) return error(ctx, 409, "다른 편집 내용이 먼저 저장되어 복원하지 못했습니다.");
    const target = doc.versions.find((item) => item.version === Number(ctx.params.version));
    if (!target) return error(ctx, 404, "복원할 버전을 찾을 수 없습니다.");
    ctx.json(200, saveVersion(doc, target.markdown ?? "", ctx.user.id));
  });

  router.post("/api/workspaces/:wid/documents/:id/ingest", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const doc = requireDocument(ctx, workspace);
    if (!doc) return;
    if (doc.document_role !== "EDITABLE") return error(ctx, 400, "편집 가능한 Markdown 문서만 분석할 수 있습니다.");
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
}
