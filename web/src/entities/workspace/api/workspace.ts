import { apiFetch, idempotencyKey, parseJsonOrThrow, throwIfNotOk, workspacePath, ERROR_MESSAGES } from "@/shared/api/client";
import type { WorkspaceListResponse, WorkspaceResponse } from "@/entities/workspace/model/workspace";

export async function fetchWorkspaces(): Promise<WorkspaceListResponse> {
  const response = await apiFetch("/api/workspaces", { cache: "no-store" });
  return parseJsonOrThrow<WorkspaceListResponse>(response, ERROR_MESSAGES.workspaceLoadFailed);
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceResponse> {
  const response = await apiFetch(workspacePath(workspaceId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  return parseJsonOrThrow<WorkspaceResponse>(response, "워크스페이스 이름을 변경하지 못했습니다.");
}

/** 업로드 자동 편입 설정을 바꾼다. OWNER만 가능하고, 그 외에는 이름 변경과 같은 규칙으로 404다. */
export async function updateWorkspaceAutoIngest(workspaceId: string, enabled: boolean): Promise<WorkspaceResponse> {
  const response = await apiFetch(workspacePath(workspaceId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auto_ingest_on_upload: enabled })
  });
  return parseJsonOrThrow<WorkspaceResponse>(response, "자동 편입 설정을 변경하지 못했습니다.");
}

/** 워크스페이스를 삭제한다. OWNER만 가능하다. */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const response = await apiFetch(workspacePath(workspaceId), {
    method: "DELETE",
    headers: { "Idempotency-Key": idempotencyKey() }
  });
  await throwIfNotOk(response, "워크스페이스를 삭제하지 못했습니다.");
}

export async function createWorkspace(name: string): Promise<WorkspaceResponse> {
  const response = await apiFetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  return parseJsonOrThrow<WorkspaceResponse>(response, ERROR_MESSAGES.workspaceCreateFailed);
}

export async function uploadWorkspaceIcon(workspaceId: string, file: File): Promise<WorkspaceResponse> {
  const body = new FormData();
  body.append("file", file);
  const response = await apiFetch(workspacePath(workspaceId, "icon", "image"), { method: "PUT", body });
  return parseJsonOrThrow<WorkspaceResponse>(response, "아이콘 이미지를 업로드하지 못했습니다.");
}

export async function fetchWorkspaceIcon(workspaceId: string): Promise<Blob> {
  const response = await apiFetch(workspacePath(workspaceId, "icon", "image"), { cache: "no-store" });
  await throwIfNotOk(response, "아이콘 이미지를 불러오지 못했습니다.");
  return response.blob();
}
