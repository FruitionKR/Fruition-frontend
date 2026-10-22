import { apiFetch, parseJsonOrThrow, getWorkspaceId, workspacePath, ERROR_MESSAGES } from "@/shared/api/client";
import type { NoteContentResponse } from "@/entities/document/model/document";
import type { PendingImage, SavedAttachment } from "../model/imageAttachments";

/**
 * 저장 409(DOCUMENT_VERSION_CONFLICT). 자동 병합을 하는 서버는 더 이상 보내지 않고, 자동 병합 이전 서버만 보낸다.
 * currentRevision은 서버 현재 revision(error.current_revision)이며 없으면 null이다.
 */
export class NoteContentConflictError extends Error {
  readonly currentRevision: number | null;

  constructor(message: string, currentRevision: number | null = null) {
    super(message);
    this.name = "NoteContentConflictError";
    this.currentRevision = currentRevision;
  }
}

/** 본문 저장 응답의 merge 필드 원형. 구 서버는 보내지 않는다. */
export type RawSaveMerge = {
  status?: unknown;
  base_version?: unknown;
  server_version?: unknown;
  overwritten_version?: unknown;
};

/**
 * 서버 자동 병합 결과. 기준 버전 이후 다른 곳의 저장이 있었을 때만 생긴다.
 * merged는 겹치지 않아 양쪽을 합친 것, overwritten은 겹친 부분을 이번 저장(나중 쪽)으로 덮은 것이다.
 * 덮인 쪽은 overwrittenVersion의 버전 기록에 남아 복원할 수 있다.
 */
export type NoteSaveMerge = {
  status: "merged" | "overwritten";
  baseVersion: number | null;
  serverVersion: number | null;
  overwrittenVersion: number | null;
};

function version(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** merge 필드를 읽는다. none·누락·모르는 status는 병합이 없었던 것으로 본다(null). */
export function parseSaveMerge(raw: RawSaveMerge | null | undefined): NoteSaveMerge | null {
  if (!raw || (raw.status !== "merged" && raw.status !== "overwritten")) return null;
  return {
    status: raw.status,
    baseVersion: version(raw.base_version),
    serverVersion: version(raw.server_version),
    overwrittenVersion: version(raw.overwritten_version)
  };
}

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
  /** 서버 자동 병합 결과. 구 서버는 보내지 않는다. */
  merge?: RawSaveMerge | null;
};

export type NoteSaveResult = NoteContentResponse & {
  attachments: SavedAttachment[];
  /** 기준 버전 이후 다른 곳의 저장과 합쳐졌으면 그 결과. markdown은 서버에 저장된 최종 본문이다. */
  merge: NoteSaveMerge | null;
};

/** 409 응답에서 메시지와 서버 현재 revision(error.current_revision)을 읽는다. */
function parseVersionConflict(body: unknown): { message: string | null; currentRevision: number | null } {
  const error = (body as { error?: { message?: unknown; current_revision?: unknown } } | null)?.error;
  const currentRevision = typeof error?.current_revision === "number" && Number.isFinite(error.current_revision)
    ? error.current_revision
    : null;
  return { message: typeof error?.message === "string" ? error.message : null, currentRevision };
}

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
    const conflict = parseVersionConflict(await response.json().catch(() => null));
    throw new NoteContentConflictError(conflict.message ?? "다른 편집 내용이 먼저 저장되었습니다.", conflict.currentRevision);
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
    attachments: saved.attachments ?? [],
    merge: parseSaveMerge(saved.merge)
  };
}
