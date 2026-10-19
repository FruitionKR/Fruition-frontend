import { apiFetch, getWorkspaceId, parseJsonOrThrow, workspacePath } from "@/shared/api/client";

export type DocumentVersionItem = {
  version: number;
  content_hash: string;
  created_by: string | null;
  created_at: string;
  /** Agent 편집 적용으로 만든 버전이면 그 적용 ID(turn의 apply_operation_id). 그 밖에는 null. */
  operation_id?: string | null;
};

export type DocumentVersionList = {
  document_id: string;
  /** 현재 편집 revision. */
  current_version: number;
  /** 최신이 먼저 온다. */
  versions: DocumentVersionItem[];
};

/** 편집 Markdown 문서의 본문 저장 이력(최신순). */
export async function fetchDocumentVersions(documentId: string): Promise<DocumentVersionList> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "documents", documentId, "versions"), { cache: "no-store" });
  const data = await parseJsonOrThrow<DocumentVersionList>(response, "버전 기록을 불러오지 못했습니다.");
  return { ...data, versions: Array.isArray(data.versions) ? data.versions : [] };
}

