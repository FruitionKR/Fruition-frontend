import { apiFetch, getWorkspaceId, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import type { ConflictChoice, ConflictResolveRequest } from "../model/editConflict";

export type EditConflictStatus = "open" | "resolved";

export type EditConflict = {
  id: string;
  document_id: string;
  base_revision: number;
  markdown: string;
  author_user_id: string;
  status: EditConflictStatus;
  resolution: ConflictChoice | null;
  resolved_by: string | null;
  resolved_revision: number | null;
  created_at: string;
  resolved_at: string | null;
};

/** OWNER 목록 항목: 충돌 본과 비교할 서버 현재 본문을 함께 준다. */
export type EditConflictEntry = {
  conflict: EditConflict;
  document_name: string;
  server: { markdown: string; revision: number; updated_by: string | null; updated_at: string };
};

/**
 * 저장 409 뒤 내 본문을 충돌로 등록한다. 같은 client_conflict_id 재전송은 기존 충돌을 돌려주므로
 * 네트워크 재시도로 중복 등록되지 않는다.
 */
export async function registerEditConflict(
  documentId: string,
  body: { markdown: string; base_revision: number; client_conflict_id: string }
): Promise<EditConflict> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "documents", documentId, "conflicts"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseJsonOrThrow<EditConflict>(response, "편집 충돌을 등록하지 못했습니다.");
}

/** OWNER용 미해결 충돌 목록(오래된 순). 휴지통 문서의 충돌은 빠진다. */
export async function fetchEditConflicts(): Promise<EditConflictEntry[]> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "conflicts"), { cache: "no-store" });
  const data = await parseJsonOrThrow<{ conflicts: EditConflictEntry[] }>(response, "편집 충돌 목록을 불러오지 못했습니다.");
  return Array.isArray(data.conflicts) ? data.conflicts : [];
}

/** OWNER가 충돌을 해결한다. 이미 해결됐으면 409 CONFLICT_ALREADY_RESOLVED(ApiError.code). */
export async function resolveEditConflict(conflictId: string, request: ConflictResolveRequest): Promise<EditConflict> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "conflicts", conflictId, "resolve"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  return parseJsonOrThrow<EditConflict>(response, "충돌을 해결하지 못했습니다.");
}
