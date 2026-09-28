import { apiFetch, parseErrorResponse, parseJsonOrThrow, getWorkspaceId, workspacePath, ERROR_MESSAGES } from "@/shared/api/client";
import type { NoteContentResponse } from "@/entities/document/model/document";
import type { PendingImage, SavedAttachment } from "../model/imageAttachments";

export class NoteContentConflictError extends Error {}

type DocumentDetailContentResponse = {
  id: string;
  markdown?: string | null;
  current_version: number;
  /** 본문 편집 revision — 저장 시 base_revision 기준값 (current_version과 분리) */
  edit_revision?: number;
  updated_at: string;
};

type DocumentContentSaveResponse = {
  document_id: string;
  current_version: number;
  updated_at: string;
  /** 이미지 포함 저장이면 placeholder가 관리 경로로 치환된 본문 */
  markdown?: string | null;
  attachments?: SavedAttachment[];
};

export type NoteSaveResult = NoteContentResponse & { attachments: SavedAttachment[] };

/** 문서 상세에서 최신 Markdown 편집본을 조회한다. 편집본이 없으면 원본 문서를 사용하도록 null을 반환한다. */
export async function fetchNoteDraft(documentId: string): Promise<NoteContentResponse | null> {
  const workspaceId = getWorkspaceId();
  const response = await apiFetch(
    workspacePath(workspaceId, "documents", documentId),
    { cache: "no-store" }
  );
  if (response.status === 404) return null;
  const detail = await parseJsonOrThrow<DocumentDetailContentResponse>(
    response,
    ERROR_MESSAGES.noteDraftLoadFailed
  );
  if (typeof detail.markdown !== "string") return null;
  return {
    document_id: detail.id,
    markdown: detail.markdown,
    content_version: detail.edit_revision ?? detail.current_version,
    updated_at: detail.updated_at
  };
}

export async function saveNoteDraft(
  documentId: string,
  markdown: string,
  expectedContentVersion: number,
  source?: "agent",
  applyOperationId?: string,
  attachments: PendingImage[] = []
): Promise<NoteSaveResult> {
  const workspaceId = getWorkspaceId();
  const formData = new FormData();
  if (attachments.length > 0) {
    // 새 이미지가 있으면 metadata JSON + attachment_<uuid> file part 계약을 쓴다. 서버가 placeholder를 관리 경로로 치환한다.
    // JSON은 개행이 \n으로 이스케이프돼 문자열 part의 CRLF 변환 영향을 받지 않는다.
    // 이 경로는 revision_write_id를 받지 않는다. 서버(DocumentAssetContentService)가 base_version·본문 해시·첨부 해시로
    // 쓰기 ID를 결정적으로 만들어 같은 요청의 재시도를 멱등 처리하므로 이미지가 중복 저장되지 않는다.
    formData.append("metadata", JSON.stringify({ markdown, base_version: expectedContentVersion }));
    attachments.forEach((image) => formData.append(`attachment_${image.id}`, image.file, image.file.name || "image"));
  } else {
    // 문자열 part는 전송 시 LF가 CRLF로 바뀐다. AI 승인 원문과 같은 바이트를 보낸다.
    formData.append("markdown", new Blob([markdown], { type: "text/plain;charset=UTF-8" }), "content.md");
    formData.append("base_revision", String(expectedContentVersion));
    // 같은 저장의 네트워크 재시도를 서버가 멱등 처리할 수 있게 쓰기 ID를 부여한다
    formData.append("revision_write_id", crypto.randomUUID());
    if (source) formData.append("source", source);
  }
  if (source === "agent") formData.append("apply_operation_id", applyOperationId ?? "");
  const response = await apiFetch(
    workspacePath(workspaceId, "documents", documentId, "content"),
    {
      method: "PUT",
      body: formData
    }
  );
  if (response.status === 409) {
    throw new NoteContentConflictError(await parseErrorResponse(response, "다른 편집 내용이 먼저 저장되었습니다."));
  }
  const saved = await parseJsonOrThrow<DocumentContentSaveResponse>(
    response,
    ERROR_MESSAGES.noteDraftSaveFailed
  );
  return {
    document_id: saved.document_id,
    markdown: saved.markdown ?? markdown,
    content_version: saved.current_version,
    updated_at: saved.updated_at,
    attachments: saved.attachments ?? []
  };
}
