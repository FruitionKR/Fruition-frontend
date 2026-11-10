import { prepareConversionFolder, placeConvertedDocument } from "@/entities/tree/api/conversionFolder";
import { fetchDocumentTree } from "@/entities/tree/api/documentTree";
import { findServerTreeItem, findServerParent } from "@/entities/tree/model/serverTree";
import { apiFetch, throwIfNotOk, parseApiError, parseJsonOrThrow, getWorkspaceId, workspacePath, ERROR_MESSAGES, idempotencyKey, idempotentJsonHeaders } from "@/shared/api/client";
import { hasPdfExtension } from "@/entities/document/lib/documentKind";
import { CHAT_EXPORT_TITLE_LOCKED_MESSAGE, DOCUMENT_TITLE_LOCKED_CODE } from "@/entities/document/lib/documentAccess";
import { ApiError } from "@/shared/lib/apiErrors";
import { sharedText } from "@/shared/i18n/sharedTranslate";
import { SKILL_REFERENCE_ORIGIN, type DocumentBlocksResponse, type DocumentItemResponse, type DocumentListResponse, type DocumentRole, type DocumentUploadResponse } from "@/entities/document/model/document";

import { getDocumentTransport } from "@/shared/api/documentTransport";
import { uploadPdfMultipart } from "@/entities/document/api/multipartUpload";
import { DOCUMENT_DIRECT_UPLOAD_MAX_BYTES, DOCUMENT_FORM_UPLOAD_MAX_BYTES, uploadSizeLimitMessage } from "@/shared/config/uploadLimits";
import { flushPendingDocumentSave } from "@/shared/lib/documentSaveBarrier";
import { createConcurrencyLimiter } from "@/shared/lib/concurrencyLimit";

export class DocumentNameConflictError extends Error {
  constructor(filename: string) {
    super(sharedText("documentRequests.document.nameConflict", `같은 폴더에 '${filename}' 이름의 항목이 이미 있습니다. 다른 이름을 사용해 주세요.`, { filename }));
    this.name = "DocumentNameConflictError";
  }
}

// 같은 탭의 병렬 이름 변경이 목록 조회 사이에 같은 이름을 선점하지 않게 한다.
const pendingDocumentNames = new Set<string>();

async function withUniqueDocumentName<T>(
  workspaceId: string,
  filename: string,
  excludedDocumentId: string | null,
  action: () => Promise<T>,
  folderId: string | null = null
): Promise<T> {
  const normalize = (value: string) => value.trim().normalize("NFC").toLowerCase();
  const name = normalize(filename);
  const tree = await fetchDocumentTree(workspaceId);
  const parentId = excludedDocumentId ? findServerParent(tree.items, excludedDocumentId) : folderId;
  if (parentId === undefined) throw new Error(sharedText("documentRequests.document.notFound", "문서를 찾을 수 없습니다. 목록을 새로고침해 주세요."));
  const reservation = JSON.stringify([workspaceId, parentId, name]);
  if (pendingDocumentNames.has(reservation)) throw new DocumentNameConflictError(filename);
  pendingDocumentNames.add(reservation);
  try {
    const parent = parentId ? findServerTreeItem(tree.items, parentId) : null;
    if (parentId && (!parent || parent.type !== "folder")) throw new Error(sharedText("documentRequests.document.uploadFolderMissing", "업로드할 폴더를 찾을 수 없습니다."));
    const siblings = parent ? parent.children ?? [] : tree.items;
    if (siblings.some((item) => item.id !== excludedDocumentId && normalize(item.name) === name)) {
      throw new DocumentNameConflictError(filename);
    }
    return await action();
  } finally {
    pendingDocumentNames.delete(reservation);
  }
}

async function fetchDocumentList(query = ""): Promise<DocumentItemResponse[]> {
  const response = await apiFetch(`${workspacePath(getWorkspaceId(), "documents")}${query}`, { cache: "no-store" });
  const data = await parseJsonOrThrow<DocumentListResponse>(response, ERROR_MESSAGES.documentsLoadFailed);
  return data.documents ?? [];
}

export async function fetchDocuments() {
  return fetchDocumentList();
}

/** 스킬 참고 문서 목록. 서버가 최근 업로드 순으로 준다. 기본 목록(fetchDocuments)에는 나오지 않는다. */
export async function fetchSkillReferenceDocuments() {
  return fetchDocumentList(`?origin=${SKILL_REFERENCE_ORIGIN}`);
}

/**
 * 스킬 참고 문서로 올린다. Markdown·txt만 받고(PDF는 415) 폴더에 둘 수 없다.
 * 이름은 참고 문서끼리만 비교해 서버가 `(2)`처럼 번호를 붙인다.
 */
export async function uploadSkillReferenceDocument(file: File) {
  assertUploadSize(file, DOCUMENT_FORM_UPLOAD_MAX_BYTES);
  const workspaceId = getWorkspaceId();
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch(`${workspacePath(workspaceId, "documents")}?origin=${SKILL_REFERENCE_ORIGIN}`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: formData
  });

  return parseJsonOrThrow<DocumentUploadResponse>(response, ERROR_MESSAGES.uploadFailed);
}

/**
 * 파일을 업로드한다. 같은 폴더에 같은 이름이 있어도 서버가 `이름 (2).pdf`처럼 번호를 붙여 저장하므로
 * 이름 중복을 미리 막지 않는다. 실제 저장된 이름은 응답의 filename이다.
 */
/**
 * 이 탭에서 동시에 보내는 문서 업로드 수. 서버는 사용자별 저장 용량·업로드 한도 확인을 직렬로 처리하므로
 * 여러 파일을 한꺼번에 놓아도 2개씩만 보내고 나머지는 순서대로 기다린다.
 * onStart는 기다리던 업로드가 실제로 보내지기 시작할 때 부른다(트리 행을 "대기 중"에서 "업로드 중"으로 바꾼다).
 * 시도마다 새 Idempotency-Key를 쓰므로(sendDocumentUpload·uploadPdfMultipart) 다시 올리기는 새 업로드다.
 */
export const DOCUMENT_UPLOAD_CONCURRENCY = 2;
const limitDocumentUpload = createConcurrencyLimiter(DOCUMENT_UPLOAD_CONCURRENCY);

export type DocumentUploadHooks = {
  /** beforeSend를 통과해 실제로 보내기 시작할 때 부른다. */
  onStart?: () => void;
  /** 대기열에서 자리를 얻는 순간(onStart 전에) 부른다. 던지면 보내지 않고 그 오류로 실패한다(워크스페이스가 바뀐 경우 등). */
  beforeSend?: () => void;
};

export function uploadDocumentFile(
  file: File,
  folderId: string | null = null,
  { onStart, beforeSend }: DocumentUploadHooks = {}
): Promise<DocumentUploadResponse> {
  // 자리를 얻는 순간(빈 자리면 이 호출 안에서 동기적으로) 보내도 되는지 확인하고, 통과했을 때만 "업로드 중"으로 알린다.
  let blocked: { error: unknown } | null = null;
  return limitDocumentUpload(() => {
    if (blocked) throw blocked.error;
    return sendDocumentUpload(file, folderId);
  }, () => {
    try {
      beforeSend?.();
    } catch (error) {
      blocked = { error };
      return;
    }
    onStart?.();
  });
}

async function sendDocumentUpload(file: File, folderId: string | null): Promise<DocumentUploadResponse> {
  const workspaceId = getWorkspaceId();
  const transport = await getDocumentTransport();
  if (transport.directUpload && hasPdfExtension(file.name)) {
    assertUploadSize(file, DOCUMENT_DIRECT_UPLOAD_MAX_BYTES);
    return uploadPdfMultipart(workspacePath(workspaceId, "documents", "uploads"), file, folderId);
  }
  assertUploadSize(file, DOCUMENT_FORM_UPLOAD_MAX_BYTES);
  const formData = new FormData();
  formData.append("file", file);
  if (folderId) formData.append("folder_id", folderId);

  const response = await apiFetch(workspacePath(workspaceId, "documents"), {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: formData
  });

  return parseJsonOrThrow<DocumentUploadResponse>(response, ERROR_MESSAGES.uploadFailed);
}

/**
 * Markdown 본문으로 새 문서를 만든다(`POST /documents/markdown`). 업로드처럼 저장 용량 한도를 적용한다(STORAGE_QUOTA_EXCEEDED).
 * 서버가 표시 이름 뒤에 `.md`를 붙이므로 displayName에는 확장자를 넣지 않는다.
 * agentRunId가 요청자 본인의 작업 탭 초안(markdown_create) run이면 서버가 AI 생성 문서로 만든다. 맞지 않으면 일반 문서다.
 */
export function createMarkdownDocument(request: {
  displayName: string;
  markdown: string;
  folderId: string | null;
  agentRunId: string | null;
}): Promise<DocumentUploadResponse> {
  return limitDocumentUpload(async () => {
    const response = await apiFetch(workspacePath(getWorkspaceId(), "documents", "markdown"), {
      method: "POST",
      headers: idempotentJsonHeaders(),
      body: JSON.stringify({
        display_name: request.displayName,
        markdown: request.markdown,
        folder_id: request.folderId,
        agent_run_id: request.agentRunId
      })
    });
    return parseJsonOrThrow<DocumentUploadResponse>(response, ERROR_MESSAGES.uploadFailed);
  });
}

/** 서버 상한을 명백히 넘는 파일은 전송하지 않고 바로 실패시킨다. 최종 판단은 서버(FILE_TOO_LARGE)가 한다. */
function assertUploadSize(file: { size: number }, maxBytes: number): void {
  const message = uploadSizeLimitMessage(file, maxBytes);
  if (message) throw new Error(message);
}

/** 문서 ingest를 시작한다. 편집 가능 Markdown 전용이라 reflectDocumentToWiki를 거쳐 호출한다. */
async function startDocumentIngest(documentId: string): Promise<void> {
  const workspaceId = getWorkspaceId();
  await flushPendingDocumentSave(documentId);
  if (getWorkspaceId() !== workspaceId) throw new Error(sharedText("documentRequests.document.workspaceChanged", "워크스페이스가 변경되어 위키 편입을 중단했습니다."));
  const response = await apiFetch(
    workspacePath(workspaceId, "documents", documentId, "ingest"),
    { method: "POST" }
  );
  await throwIfNotOk(response, sharedText("documentRequests.document.ingestStartFailed", "위키 편입 시작에 실패했습니다."));
}

/**
 * PDF 원본 문서의 Markdown 변환을 요청한다.
 * 202와 함께 processing 상태로 생성된 markdown 문서 요약을 반환한다.
 */
export async function convertDocumentToMarkdown(documentId: string) {
  const folderId = await prepareConversionFolder(documentId);
  const workspaceId = getWorkspaceId();
  const response = await apiFetch(
    workspacePath(workspaceId, "documents", documentId, "convert-markdown"),
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey() }
    }
  );
  const converted = await parseJsonOrThrow<DocumentItemResponse>(response, ERROR_MESSAGES.documentConvertFailed);
  await placeConvertedDocument(converted.id, folderId);
  return converted;
}

/**
 * 위키 반영 진입점.
 * ingest는 편집 가능 Markdown만 받으므로(그 외 400) PDF 등 원본 문서는 Markdown 변환으로 보낸다.
 */
export async function reflectDocumentToWiki(
  documentId: string,
  documentRole: DocumentRole | undefined
): Promise<void> {
  if (documentRole === "EDITABLE") {
    await startDocumentIngest(documentId);
    return;
  }
  await convertDocumentToMarkdown(documentId);
}

/**
 * 문서를 소프트 삭제한다.
 * 낙관적 잠금 계약이라 현재 버전을 조회해 base_version으로 보낸다(불일치 시 409).
 */
export async function deleteDocument(documentId: string): Promise<void> {
  const workspaceId = getWorkspaceId();
  const detailResponse = await apiFetch(
    workspacePath(workspaceId, "documents", documentId),
    { cache: "no-store" }
  );
  const detail = await parseJsonOrThrow<{ current_version?: unknown } | null>(
    detailResponse,
    ERROR_MESSAGES.documentDeleteFailed
  );
  // 상세 응답이 null이거나 값이 없는 필드의 키가 빠질 수 있어 base_version 유실을 막기 위해 검증한다.
  const current_version = detail?.current_version;
  if (typeof current_version !== "number" || !Number.isFinite(current_version)) {
    throw new Error(ERROR_MESSAGES.documentDeleteFailed);
  }
  const response = await apiFetch(
    workspacePath(workspaceId, "documents", documentId),
    {
      method: "DELETE",
      headers: idempotentJsonHeaders(),
      body: JSON.stringify({ base_version: current_version })
    }
  );
  await throwIfNotOk(response, ERROR_MESSAGES.documentDeleteFailed);
}

/** 문서 표시명을 변경한다. */
export async function renameDocument(documentId: string, filename: string, folderId: string | null = null): Promise<void> {
  const workspaceId = getWorkspaceId();
  const detailResponse = await apiFetch(workspacePath(workspaceId, "documents", documentId), { cache: "no-store" });
  const detail = await parseJsonOrThrow<{ current_version?: number; filename?: string } | null>(
    detailResponse, ERROR_MESSAGES.documentRenameFailed
  );
  if (!detail || !Number.isInteger(detail.current_version) || !detail.current_version || !detail.filename) {
    throw new Error(ERROR_MESSAGES.documentRenameFailed);
  }
  const extensionIndex = detail.filename.lastIndexOf(".");
  const extension = extensionIndex > 0 ? detail.filename.slice(extensionIndex) : "";
  const name = filename.trim().normalize("NFC");
  const displayName = extension && name.toLowerCase().endsWith(extension.toLowerCase())
    ? name.slice(0, -extension.length) : name;
  await withUniqueDocumentName(workspaceId, `${displayName}${extension}`, documentId, async () => {
    const response = await apiFetch(
      workspacePath(workspaceId, "documents", documentId, "rename"),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName, base_version: detail.current_version })
      }
    );
    if (!response.ok) {
      const error = await parseApiError(response, ERROR_MESSAGES.documentRenameFailed);
      // 채팅에서 만든 문서는 서버가 이름을 잠근다. 화면 안내와 같은 문구로 보여 준다.
      if (error.code === DOCUMENT_TITLE_LOCKED_CODE) throw new ApiError(CHAT_EXPORT_TITLE_LOCKED_MESSAGE, error.status, error.code);
      throw error;
    }
  }, folderId);
}

/** 현재 워크스페이스의 원본 문서를 인증된 요청으로 가져온다. */
export async function fetchDocumentOriginal(documentId: string): Promise<Blob> {
  const workspaceId = getWorkspaceId();
  const response = await apiFetch(
    workspacePath(workspaceId, "documents", documentId, "original"),
    { cache: "no-store" }
  );

  await throwIfNotOk(response, ERROR_MESSAGES.documentOriginalLoadFailed);
  return response.blob();
}

/** 원본을 직접 여는 임시 읽기 URL(presigned). 저장소가 지원하지 않으면 null. */
export async function fetchDocumentReadUrl(documentId: string): Promise<string | null> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "documents", documentId, "original-url"), { cache: "no-store" });
  const result = await parseJsonOrThrow<{ url: string | null }>(response, ERROR_MESSAGES.documentOriginalLoadFailed);
  return result.url;
}


/** 근거 하이라이트용 원본 block 목록. 문서 순서이며 영구 block ID와 스냅샷 기준 줄 범위를 준다. */
export async function fetchDocumentBlocks(documentId: string): Promise<DocumentBlocksResponse> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "documents", documentId, "blocks"), { cache: "no-store" });
  const result = await parseJsonOrThrow<DocumentBlocksResponse>(response, ERROR_MESSAGES.documentBlocksLoadFailed);
  return { ...result, blocks: Array.isArray(result.blocks) ? result.blocks : [] };
}
