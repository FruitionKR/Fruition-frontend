import { apiFetch, getWorkspaceId, parseJsonOrThrow, workspacePath } from "@/shared/api/client";

export type DocumentVersionItem = {
  version: number;
  content_hash: string;
  created_by: string | null;
  created_at: string;
  /** Agent 편집 적용으로 만든 버전이면 그 적용 ID(turn의 apply_operation_id). 그 밖에는 null. */
  operation_id?: string | null;
  /** 자동 병합 결과(document #152). merged·overwritten, V80이 옮긴 충돌 본문은 conflict_archived, 그 밖에는 null. */
  merge_status?: "merged" | "overwritten" | "conflict_archived" | null;
};

/** 버전 목록에 붙일 자동 병합 표시. 모르는 값·null이면 붙이지 않는다. */
export function versionMergeStatusLabel(status: string | null | undefined): string | null {
  switch (status) {
    case "merged": return "자동 병합";
    case "overwritten": return "덮어씀";
    case "conflict_archived": return "충돌 보관본";
    default: return null;
  }
}

export type DocumentVersionList = {
  document_id: string;
  /** 현재 편집 revision. 복원 요청의 base_version으로 쓴다. */
  current_version: number;
  /** 최신이 먼저 온다. */
  versions: DocumentVersionItem[];
};

export type DocumentVersionDetail = {
  document_id: string;
  version: number;
  markdown: string;
  created_by: string | null;
  created_at: string;
};

/** 편집 Markdown 문서의 본문 저장 이력(최신순). */
export async function fetchDocumentVersions(documentId: string): Promise<DocumentVersionList> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "documents", documentId, "versions"), { cache: "no-store" });
  const data = await parseJsonOrThrow<DocumentVersionList>(response, "버전 기록을 불러오지 못했습니다.");
  return { ...data, versions: Array.isArray(data.versions) ? data.versions : [] };
}

/** 특정 버전의 전체 본문. */
export async function fetchDocumentVersion(documentId: string, version: number): Promise<DocumentVersionDetail> {
  const response = await apiFetch(
    workspacePath(getWorkspaceId(), "documents", documentId, "versions", String(version)),
    { cache: "no-store" }
  );
  return parseJsonOrThrow<DocumentVersionDetail>(response, "이 버전의 본문을 불러오지 못했습니다.");
}

/** 특정 버전의 본문으로 되돌린다. 서버는 이를 새 버전으로 저장하므로 지금 본문도 기록에 남는다. */
export async function restoreDocumentVersion(documentId: string, version: number, baseVersion: number): Promise<void> {
  const response = await apiFetch(
    workspacePath(getWorkspaceId(), "documents", documentId, "versions", String(version), "restore"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_version: baseVersion })
    }
  );
  await parseJsonOrThrow<unknown>(response, "이 버전으로 복원하지 못했습니다.");
}
