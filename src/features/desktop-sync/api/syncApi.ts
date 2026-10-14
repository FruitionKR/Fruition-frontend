import { apiFetch, parseJsonOrThrow, throwIfNotOk, workspacePath } from "@/shared/api/client";
import { getDocumentTransport } from "@/shared/api/documentTransport";
import { hasPdfExtension } from "@/entities/document/lib/documentKind";
import { uploadPdfMultipart } from "@/entities/document/api/multipartUpload";
import { normalizeSyncName } from "@/features/desktop-sync/lib/syncNames";
import type { DocumentRole, DocumentUploadResponse } from "@/entities/document/model/document";
import type { FolderResponse } from "@/entities/tree/model/serverTree";
import type { WikiGraphResponse, WikiPageDetailResponse } from "@/entities/wiki/model/wiki";

/*
 * 동기화 엔진 전용 API. 웹 화면용 함수와 달리
 * - 워크스페이스 id를 인자로 받는다(화면이 고른 워크스페이스와 엔진이 동기화하는 워크스페이스가 다를 수 있다).
 * - base_version을 다시 조회하지 않고 엔진이 보관한 값을 보낸다(다시 조회하면 충돌을 못 잡는다).
 * - Idempotency-Key·revision_write_id를 호출부가 넘긴다(대기열에서 다시 보낼 때 같은 키를 쓴다).
 * - 파일·폴더 이름은 NFC로 바꿔 보낸다(서버는 중복이 아니면 이름을 정규화하지 않는다).
 * 실패는 서버 code를 담은 ApiError로 던지므로 classifySyncError로 분류한다.
 */

export type SyncDocumentDetail = {
  id: string;
  filename: string;
  documentRole: DocumentRole;
  /** 문서 종류상 편집 가능한지(EDITABLE·채팅 문서 아님). 현재 사용자의 편집 권한은 아니다. */
  editable: boolean;
  status: string;
  currentVersion: number;
  editRevision: number;
  updatedAt: string;
  markdown: string | null;
  folderId: string | null;
  sourceDocumentId: string | null;
};

export type SyncTrashItem = {
  id: string;
  filename: string;
  document_role: DocumentRole;
  current_version: number;
  deleted_at: string;
  source_document_id?: string | null;
};

type DocumentDetailResponse = {
  id: string;
  filename: string;
  document_role: DocumentRole;
  editable: boolean;
  status: string;
  current_version: number;
  edit_revision: number;
  updated_at: string;
  markdown?: string | null;
  folder_id?: string | null;
  source_document_id?: string | null;
};

const FAILED = "동기화 요청에 실패했습니다.";

function jsonInit(method: string, body: unknown, idempotencyKey?: string): RequestInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return { method, headers, body: JSON.stringify(body) };
}

async function send(path: string, init: RequestInit): Promise<void> {
  await throwIfNotOk(await apiFetch(path, init), FAILED);
}

export async function fetchSyncDocument(workspaceId: string, documentId: string): Promise<SyncDocumentDetail> {
  const response = await apiFetch(workspacePath(workspaceId, "documents", documentId), { cache: "no-store" });
  const detail = await parseJsonOrThrow<DocumentDetailResponse>(response, FAILED);
  return {
    id: detail.id,
    filename: detail.filename,
    documentRole: detail.document_role,
    editable: detail.editable,
    status: detail.status,
    currentVersion: detail.current_version,
    editRevision: detail.edit_revision,
    updatedAt: detail.updated_at,
    markdown: detail.markdown ?? null,
    folderId: detail.folder_id ?? null,
    sourceDocumentId: detail.source_document_id ?? null
  };
}

/** 본문 저장. 응답의 current_version 필드에는 본문 편집 revision이 담기므로 다음 base_revision으로 쓴다. */
export async function saveSyncContent(
  workspaceId: string,
  documentId: string,
  content: { markdown: string; baseRevision: number; revisionWriteId: string }
): Promise<{ revision: number; updatedAt: string }> {
  const form = new FormData();
  // 문자열 part는 전송 중 LF가 CRLF로 바뀌므로 웹 저장과 같이 Blob으로 보낸다.
  form.append("markdown", new Blob([content.markdown], { type: "text/plain;charset=UTF-8" }), "content.md");
  form.append("base_revision", String(content.baseRevision));
  form.append("revision_write_id", content.revisionWriteId);
  const response = await apiFetch(workspacePath(workspaceId, "documents", documentId, "content"), { method: "PUT", body: form });
  const saved = await parseJsonOrThrow<{ current_version: number; updated_at: string }>(response, FAILED);
  return { revision: saved.current_version, updatedAt: saved.updated_at };
}

/** 큰 PDF는 웹과 같이 direct multipart로 올린다. 이 경로는 단계별 키를 스스로 만든다. */
export async function uploadSyncFile(
  workspaceId: string,
  file: File,
  folderId: string | null,
  idempotencyKey: string
): Promise<DocumentUploadResponse> {
  const name = normalizeSyncName(file.name);
  if (name !== file.name) file = new File([file], name, { type: file.type, lastModified: file.lastModified });
  const transport = await getDocumentTransport();
  if (transport.directUpload && hasPdfExtension(file.name)) {
    return uploadPdfMultipart(workspacePath(workspaceId, "documents", "uploads"), file, folderId);
  }
  const form = new FormData();
  form.append("file", file);
  if (folderId) form.append("folder_id", folderId);
  const response = await apiFetch(workspacePath(workspaceId, "documents"), {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: form
  });
  return parseJsonOrThrow<DocumentUploadResponse>(response, FAILED);
}

/** 서버는 확장자를 유지하고 표시 이름만 바꾼다. 확장자를 바꾸려면 삭제 후 다시 올린다. */
export function renameSyncDocument(workspaceId: string, documentId: string, displayName: string, baseVersion: number) {
  return send(
    workspacePath(workspaceId, "documents", documentId, "rename"),
    jsonInit("PATCH", { display_name: normalizeSyncName(displayName), base_version: baseVersion })
  );
}

export function moveSyncDocument(workspaceId: string, documentId: string, folderId: string | null, baseVersion: number, idempotencyKey: string) {
  return send(
    workspacePath(workspaceId, "documents", documentId, "position"),
    jsonInit("PATCH", { folder_id: folderId, base_version: baseVersion }, idempotencyKey)
  );
}

export function deleteSyncDocument(workspaceId: string, documentId: string, baseVersion: number, idempotencyKey: string) {
  return send(workspacePath(workspaceId, "documents", documentId), jsonInit("DELETE", { base_version: baseVersion }, idempotencyKey));
}

/** 복구된 문서는 역할별 최상위 폴더로 가고, 편집 문서는 다시 편입해야 한다. */
export function restoreSyncDocument(workspaceId: string, documentId: string, baseVersion: number, idempotencyKey: string) {
  return send(
    workspacePath(workspaceId, "documents", documentId, "restore"),
    jsonInit("POST", { base_version: baseVersion }, idempotencyKey)
  );
}

export async function fetchSyncTrash(workspaceId: string): Promise<SyncTrashItem[]> {
  const response = await apiFetch(workspacePath(workspaceId, "documents", "trash"), { cache: "no-store" });
  return (await parseJsonOrThrow<{ documents: SyncTrashItem[] }>(response, FAILED)).documents;
}

export async function createSyncFolder(
  workspaceId: string,
  name: string,
  parentFolderId: string | null,
  idempotencyKey: string
): Promise<FolderResponse> {
  const response = await apiFetch(
    workspacePath(workspaceId, "folders"),
    jsonInit("POST", { name: normalizeSyncName(name), parent_folder_id: parentFolderId }, idempotencyKey)
  );
  return parseJsonOrThrow<FolderResponse>(response, FAILED);
}

export function renameSyncFolder(workspaceId: string, folderId: string, name: string, baseVersion: number, idempotencyKey: string) {
  return send(workspacePath(workspaceId, "folders", folderId), jsonInit("PATCH", { name: normalizeSyncName(name), base_version: baseVersion }, idempotencyKey));
}

export function moveSyncFolder(workspaceId: string, folderId: string, parentFolderId: string | null, baseVersion: number, idempotencyKey: string) {
  return send(
    workspacePath(workspaceId, "folders", folderId, "position"),
    jsonInit("PATCH", { parent_folder_id: parentFolderId, base_version: baseVersion }, idempotencyKey)
  );
}

export function deleteSyncFolder(workspaceId: string, folderId: string, baseVersion: number, idempotencyKey: string) {
  return send(workspacePath(workspaceId, "folders", folderId), jsonInit("DELETE", { base_version: baseVersion }, idempotencyKey));
}

/** 편집 문서 편입. 서버가 멱등 키를 받지 않으므로 다시 보내기 전에 문서 상태를 확인한다. */
export function ingestSyncDocument(workspaceId: string, documentId: string) {
  return send(workspacePath(workspaceId, "documents", documentId, "ingest"), { method: "POST" });
}

/** PDF를 Markdown으로 변환한다. 변환본은 새 EDITABLE 문서로 생긴다. */
export async function convertSyncDocument(workspaceId: string, documentId: string, idempotencyKey: string): Promise<DocumentUploadResponse> {
  const response = await apiFetch(workspacePath(workspaceId, "documents", documentId, "convert-markdown"), {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey }
  });
  return parseJsonOrThrow<DocumentUploadResponse>(response, FAILED);
}

/** 원본 파일(PDF 등)을 받는다. */
export async function fetchSyncOriginal(workspaceId: string, documentId: string): Promise<Blob> {
  const response = await apiFetch(workspacePath(workspaceId, "documents", documentId, "original"), { cache: "no-store" });
  await throwIfNotOk(response, FAILED);
  return response.blob();
}

/** 위키가 마지막으로 바뀐 시각. 바뀌지 않았으면 미러를 다시 받지 않는다. */
export async function fetchSyncWikiChangedAt(workspaceId: string): Promise<string | null> {
  const response = await apiFetch(workspacePath(workspaceId, "wiki", "maintenance", "status"), { cache: "no-store" });
  return (await parseJsonOrThrow<{ last_wiki_change_at?: string | null }>(response, FAILED)).last_wiki_change_at ?? null;
}

export async function fetchSyncWikiGraph(workspaceId: string): Promise<WikiGraphResponse> {
  const response = await apiFetch(workspacePath(workspaceId, "wiki", "graph"), { cache: "no-store" });
  return parseJsonOrThrow<WikiGraphResponse>(response, FAILED);
}

export async function fetchSyncWikiPage(workspaceId: string, pageId: string): Promise<WikiPageDetailResponse> {
  const response = await apiFetch(workspacePath(workspaceId, "wiki", "pages", pageId), { cache: "no-store" });
  return parseJsonOrThrow<WikiPageDetailResponse>(response, FAILED);
}
