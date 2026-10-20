import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { CONVERT_FORBIDDEN_REASON, canConvertDocument } = await import("../src/entities/document/lib/documentAccess.ts");
const { projectsFromServerTree } = await import("../src/entities/tree/lib/projectsFromServerTree.ts");
const { getGraphIngestBlockReason, GRAPH_INGEST_BLOCK_REASONS } = await import("../src/features/wiki-ingest/model/graphDocuments.ts");
const { createRouter, issueAccessToken, listen } = await import("../mock/lib/http.mjs");
const { state, canConvertDocument: mockCanConvert } = await import("../mock/state.mjs");
const { registerDocumentRoutes } = await import("../mock/routes/documents.mjs");

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const pdf = { id: "pdf", filename: "보고서.pdf", mime_type: "application/pdf", document_role: "ORIGINAL", status: "completed" };

test("can_convert가 false일 때만 변환을 막고, 필드가 없는 구 서버는 지금처럼 요청한다", () => {
  assert.equal(canConvertDocument({ can_convert: false }), false);
  assert.equal(canConvertDocument({ can_convert: true }), true);
  assert.equal(canConvertDocument({}), true);
  assert.equal(canConvertDocument(null), true);
});

test("서버 트리의 can_convert가 트리 항목 canConvert로 옮겨진다", () => {
  const [project] = projectsFromServerTree([
    { id: "doc_1", type: "document", name: "a.pdf", current_version: 1,
      document: { ...pdf, id: "doc_1", byte_size: 1, source_uri: "", uploaded_at: "", can_convert: false } },
    { id: "doc_2", type: "document", name: "b.pdf", current_version: 1,
      document: { ...pdf, id: "doc_2", byte_size: 1, source_uri: "", uploaded_at: "" } }
  ]);
  assert.equal(project.items.find((item) => item.documentId === "doc_1").canConvert, false);
  assert.equal(project.items.find((item) => item.documentId === "doc_2").canConvert, undefined);
});

test("변환 권한이 없는 PDF는 위키 편입 선택에서 같은 이유로 막고, 이미 변환본이 있으면 그 안내를 먼저 보인다", () => {
  const forbidden = { ...pdf, can_convert: false };
  assert.equal(GRAPH_INGEST_BLOCK_REASONS.convertForbidden, CONVERT_FORBIDDEN_REASON);
  assert.equal(getGraphIngestBlockReason(forbidden, [forbidden]), CONVERT_FORBIDDEN_REASON);
  assert.equal(getGraphIngestBlockReason({ ...pdf, can_convert: true }, [pdf]), null);
  assert.equal(getGraphIngestBlockReason(pdf, [pdf]), null);
  const converted = { id: "md", filename: "보고서.md", mime_type: "text/markdown", document_role: "EDITABLE", status: "completed", source_document_id: "pdf", pipeline_run_id: "convert:md" };
  assert.equal(getGraphIngestBlockReason(forbidden, [forbidden, converted]), GRAPH_INGEST_BLOCK_REASONS.pdfConverted);
});

test("컨텍스트 메뉴는 변환 권한이 없으면 Markdown으로 변환을 이유와 함께 비활성화하고 요청을 보내지 않는다", async () => {
  const [menu, tree, ingest] = await Promise.all([
    source("../src/widgets/document-sidebar/ui/ContextMenu.tsx"),
    source("../src/widgets/workspace/model/useProjectTree.ts"),
    source("../src/features/wiki-ingest/model/usePdfWikiIngest.ts")
  ]);
  assert.match(menu, /role="menuitem"[\s\S]*disabled=\{convertTarget\.isDisabled\}\s*title=\{convertTarget\.disabledReason\}\s*aria-description=\{convertTarget\.disabledReason\}/);
  assert.match(tree, /isDisabled: !canConvertContextItem \|\|/);
  assert.match(tree, /disabledReason: canConvertContextItem \? undefined : CONVERT_FORBIDDEN_REASON/);
  assert.match(tree, /if \(!itemId \|\| !documentId \|\| !canConvertContextItem\) return;/);
  // PDF 위키 편입은 변환부터 하므로 권한이 없으면 convert 요청 전에 같은 이유로 실패시킨다.
  assert.match(ingest, /if \(!canConvertDocument\(document\)\) throw new Error\(CONVERT_FORBIDDEN_REASON\);\s*const storageKey = storageKeyRef\.current;\s*const converted = await convertDocumentToMarkdown/);
});

/** 업로더(OWNER 아님)·document.convert 없는 멤버·권한 있는 멤버로 mock 응답과 convert 판정을 확인한다. */
async function startMock(t) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const ids = { owner: `user_cv_o_${suffix}`, uploader: `user_cv_u_${suffix}`, member: `user_cv_m_${suffix}`, converter: `user_cv_c_${suffix}` };
  const workspaceId = `ws_cv_${suffix}`;
  const documentId = `doc_cv_${suffix}`;
  for (const userId of Object.values(ids)) state.users.push({ id: userId });
  state.workspaces.push({ id: workspaceId, name: "convert" });
  state.members.push(
    { workspace_id: workspaceId, user_id: ids.owner, role: "OWNER" },
    { workspace_id: workspaceId, user_id: ids.uploader, role: "MEMBER", permissions: [] },
    { workspace_id: workspaceId, user_id: ids.member, role: "MEMBER", permissions: ["wiki.ingest"] },
    { workspace_id: workspaceId, user_id: ids.converter, role: "MEMBER", permissions: ["document.convert"] }
  );
  const doc = {
    id: documentId, workspace_id: workspaceId, filename: "논문.pdf", mime_type: "application/pdf", status: "completed",
    document_role: "ORIGINAL", owner_user_id: ids.uploader, permission: null, folder_id: null, current_version: 1
  };
  state.documents.push(doc);
  const router = createRouter(state);
  registerDocumentRoutes(router);
  t.mock.method(console, "log", () => {});
  const server = await listen(router, 0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/workspaces/${workspaceId}/documents`;
  const as = (userId) => ({ Authorization: `Bearer ${issueAccessToken(state, userId)}` });
  return { ids, doc, base, as, documentId };
}

test("mock can_convert는 업로더·document.convert·OWNER만 true이고 PDF가 아니면 false다", async (t) => {
  const { ids, doc, base, as, documentId } = await startMock(t);
  assert.equal(mockCanConvert(doc, ids.uploader), true);
  assert.equal(mockCanConvert(doc, ids.owner), true);
  assert.equal(mockCanConvert(doc, ids.converter), true);
  assert.equal(mockCanConvert(doc, ids.member), false);
  assert.equal(mockCanConvert({ ...doc, mime_type: "text/markdown", document_role: "EDITABLE" }, ids.uploader), false);

  const list = await (await fetch(base, { headers: as(ids.member) })).json();
  assert.equal(list.documents.find((item) => item.id === documentId).can_convert, false);
});

test("mock convert-markdown은 권한이 없는 멤버에게 403을 돌려준다", async (t) => {
  const { ids, base, as, documentId } = await startMock(t);
  const response = await fetch(`${base}/${documentId}/convert-markdown`, { method: "POST", headers: as(ids.member) });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "WORKSPACE_PERMISSION_REQUIRED");
});
