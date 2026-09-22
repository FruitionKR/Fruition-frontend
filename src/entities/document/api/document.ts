import { apiFetch, throwIfNotOk, parseJsonOrThrow, getWorkspaceId, workspacePath, ERROR_MESSAGES } from "@/shared/api/client";
import { publishConvertStarted } from "@/entities/document/model/convertEvents";
import type { DocumentItemResponse, DocumentRole, DocumentUploadResponse } from "@/entities/document/model/document";

import { getDocumentTransport } from "@/shared/api/documentTransport";
import { uploadPdfMultipart } from "@/entities/document/api/multipartUpload";

export class DocumentNameConflictError extends Error {
  constructor(filename: string) {
    super(`같은 워크스페이스에 '${filename}' 이름의 문서가 이미 있습니다. 다른 이름을 사용해 주세요.`);
    this.name = "DocumentNameConflictError";
  }
}

// 같은 탭의 병렬 업로드·이름 변경이 목록 조회 사이에 같은 이름을 선점하지 않게 한다.
const pendingDocumentNames = new Set<string>();

async function withUniqueDocumentName<T>(
  workspaceId: string,
  filename: string,
  excludedDocumentId: string | null,
  action: () => Promise<T>
): Promise<T> {
  const normalize = (value: string) => value.trim().normalize("NFC").toLowerCase();
  const name = normalize(filename);
  const reservation = JSON.stringify([workspaceId, name]);
  if (pendingDocumentNames.has(reservation)) throw new DocumentNameConflictError(filename);
  pendingDocumentNames.add(reservation);
  try {
    const response = await apiFetch(workspacePath(workspaceId, "documents"), { cache: "no-store" });
    const data = await parseJsonOrThrow<{ documents: DocumentItemResponse[] }>(response, ERROR_MESSAGES.documentsLoadFailed);
    if ((data.documents ?? []).some((document) => document.id !== excludedDocumentId && normalize(document.filename) === name)) {
      throw new DocumentNameConflictError(filename);
    }
    return await action();
  } finally {
    pendingDocumentNames.delete(reservation);
  }
}

export async function fetchDocuments() {
  const workspaceId = getWorkspaceId();
  const response = await apiFetch(workspacePath(workspaceId, "documents"), { cache: "no-store" });
  const data = await parseJsonOrThrow<{ documents: DocumentItemResponse[] }>(
    response,
    ERROR_MESSAGES.documentsLoadFailed
  );
  return data.documents ?? [];
}

export async function uploadDocumentFile(file: File) {
  const workspaceId = getWorkspaceId();
  return withUniqueDocumentName(workspaceId, file.name, null, async () => {
    const transport = await getDocumentTransport();
    if (transport.directUpload && file.name.toLowerCase().endsWith(".pdf")) {
      return uploadPdfMultipart(workspacePath(workspaceId, "documents", "uploads"), file);
    }
    const formData = new FormData();
    formData.append("file", file);

    const response = await apiFetch(workspacePath(workspaceId, "documents"), {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: formData
    });

    return parseJsonOrThrow<DocumentUploadResponse>(response, ERROR_MESSAGES.uploadFailed);
  });
}

/** 문서 ingest를 시작한다. 편집 가능 Markdown 전용이라 reflectDocumentToWiki를 거쳐 호출한다. */
async function startDocumentIngest(documentId: string): Promise<void> {
  const workspaceId = getWorkspaceId();
  const response = await apiFetch(
    workspacePath(workspaceId, "documents", documentId, "ingest"),
    { method: "POST" }
  );
  await throwIfNotOk(response, "위키 편입 시작에 실패했습니다.");
}

/**
 * PDF 원본 문서의 Markdown 변환을 요청한다.
 * 202와 함께 processing 상태로 생성된 markdown 문서 요약을 반환한다.
 */
export async function convertDocumentToMarkdown(documentId: string, options?: { openWhenReady?: boolean }) {
  const workspaceId = getWorkspaceId();
  const response = await apiFetch(
    workspacePath(workspaceId, "documents", documentId, "convert-markdown"),
    {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() }
    }
  );
  const created = await parseJsonOrThrow<DocumentItemResponse>(response, ERROR_MESSAGES.documentConvertFailed);
  // 트리거 경로와 무관하게 변환 완료 후 자동 열기가 동작하도록 시작 이벤트를 발행한다.
  if (options?.openWhenReady !== false) publishConvertStarted(created.id);
  return created;
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
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID()
      },
      body: JSON.stringify({ base_version: current_version })
    }
  );
  await throwIfNotOk(response, ERROR_MESSAGES.documentDeleteFailed);
}

/** 문서 표시명을 변경한다. */
export async function renameDocument(documentId: string, filename: string): Promise<void> {
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
    await throwIfNotOk(response, ERROR_MESSAGES.documentRenameFailed);
  });
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


export async function fetchDocumentReadUrl(documentId: string): Promise<string | null> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "documents", documentId, "original-url"), { cache: "no-store" });
  const result = await parseJsonOrThrow<{ url: string | null }>(response, ERROR_MESSAGES.documentOriginalLoadFailed);
  return result.url;
}
