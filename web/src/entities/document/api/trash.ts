import { apiFetch, getWorkspaceId, idempotentJsonHeaders, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import type { DocumentRole } from "@/entities/document/model/document";

/** 휴지통 목록 항목. purge_at은 deleted_at + 보관 기간(30일)이며 구 서버는 생략한다. */
export type TrashDocument = {
  id: string;
  display_name: string;
  filename: string;
  document_role: DocumentRole;
  current_version: number;
  deleted_at: string;
  deleted_by: string;
  purge_at?: string | null;
  source_document_id?: string | null;
};

/** 보관 기간이 지나지 않은 삭제 문서를 삭제 시각 역순으로 받는다. */
export async function fetchTrashDocuments(): Promise<TrashDocument[]> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "documents", "trash"), { cache: "no-store" });
  const data = await parseJsonOrThrow<{ documents: TrashDocument[] }>(response, "휴지통을 불러오지 못했습니다.");
  return Array.isArray(data.documents) ? data.documents : [];
}

/**
 * 삭제 문서를 복구한다. 낙관적 잠금 계약이라 목록의 current_version을 base_version으로 보낸다.
 * 보관 기간이 지났으면 409 TRASH_RETENTION_EXPIRED(ApiError.code).
 */
export async function restoreTrashDocument(documentId: string, currentVersion: number): Promise<void> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "documents", documentId, "restore"), {
    method: "POST",
    headers: idempotentJsonHeaders(),
    body: JSON.stringify({ base_version: currentVersion })
  });
  await parseJsonOrThrow<unknown>(response, "문서를 복구하지 못했습니다.");
}
