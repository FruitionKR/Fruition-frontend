import { apiFetch, getWorkspaceId, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import type { DocumentPermission } from "@/entities/document/model/document";

type PermissionResponse = { access: DocumentPermission | null };

async function putPermission(path: string, access: DocumentPermission | null): Promise<PermissionResponse> {
  const response = await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access })
  });
  // 403 DOCUMENT_WRITE_FORBIDDEN은 ApiError.code로 전달되고, 호출부가 describePermissionError로 문구를 정한다.
  return parseJsonOrThrow<PermissionResponse>(response, "권한을 변경하지 못했습니다.");
}

/** 문서 권한 설정. 문서 소유자·OWNER만. null이면 설정을 지워 상위 폴더·기본값을 따른다. */
export function setDocumentPermission(documentId: string, access: DocumentPermission | null) {
  return putPermission(workspacePath(getWorkspaceId(), "documents", documentId, "permission"), access);
}

/** 폴더 권한 설정. OWNER만. 폴더 안 문서와 하위 폴더가 따른다. */
export function setFolderPermission(folderId: string, access: DocumentPermission | null) {
  return putPermission(workspacePath(getWorkspaceId(), "folders", folderId, "permission"), access);
}
