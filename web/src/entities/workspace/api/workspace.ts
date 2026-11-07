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

/**
 * 자동 편입 설정 필드. auto_ingest_on_upload는 구 서버용 하나짜리 설정이고, 새 서버에 보내면 두 설정이 함께 바뀐다.
 * 새 서버에서는 Markdown·PDF 설정을 각각 부분 갱신한다.
 */
export type AutoIngestSettingField = "auto_ingest_on_upload" | "auto_ingest_markdown_on_upload" | "auto_ingest_pdf_on_convert";

/** 자동 편입 설정 하나를 바꾼다. OWNER만 가능하고, 그 외에는 이름 변경과 같은 규칙으로 404다. */
export async function updateWorkspaceAutoIngest(workspaceId: string, field: AutoIngestSettingField, enabled: boolean): Promise<WorkspaceResponse> {
  const response = await apiFetch(workspacePath(workspaceId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [field]: enabled })
  });
  return parseJsonOrThrow<WorkspaceResponse>(response, "자동 편입 설정을 변경하지 못했습니다.");
}

/** PDF 그림 설명(외부 AI 전송) 설정을 바꾼다. 자동 편입 설정과 같이 OWNER만 바꿀 수 있다. */
export async function updateWorkspaceDescribePdfFigures(workspaceId: string, enabled: boolean): Promise<WorkspaceResponse> {
  const response = await apiFetch(workspacePath(workspaceId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ describe_pdf_figures: enabled })
  });
  return parseJsonOrThrow<WorkspaceResponse>(response, "PDF 변환시 이미지를 AI가 해석 가능하도록 글로 남김 설정을 변경하지 못했습니다.");
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
