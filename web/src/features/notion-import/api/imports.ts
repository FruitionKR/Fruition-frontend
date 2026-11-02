/**
 * Notion 가져오기 서버 계약(document-svc).
 * 가져오기 쓰기 요청에는 모두 X-Fruition-Import-Id를 붙인다. 서버는 이 헤더로 요청을 가져오기 세션에 묶고
 * 저장 용량(5GB)·파일별 한도를 검사한다. 가져오기 item 수 상한은 없다(max_items: null).
 */
import { apiFetch, getWorkspaceId, parseJsonOrThrow, workspacePath } from "@/shared/api/client";

export const IMPORT_ID_HEADER = "X-Fruition-Import-Id";

export type ImportSession = {
  import_id: string;
  status: string;
  expires_at?: string;
  /** 항목 상한이 없어 항상 null. 화면에서 쓰지 않는다. */
  max_items?: number | null;
  quota?: { used_bytes: number; limit_bytes: number | null };
};

export type ImportIngestEstimate = {
  /** 아직 편입하지 않은 가져온 문서 수 */
  document_count: number;
  estimated_cost_usd: number | null;
  /** 예상 크레딧(milli-KRW) */
  estimated_credits: number | null;
};

type CreatedFolder = { id: string };
type CreatedDocument = { id: string; current_version?: number };
type SavedContent = { current_version: number; attachments?: { attachment_id: string; content_path: string }[] };

function importPath(workspaceId: string, importId: string, ...segments: string[]) {
  return workspacePath(workspaceId, "imports", importId, ...segments);
}

function jsonInit(method: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal): RequestInit {
  return { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal };
}

export async function createImportSession(itemCount: number, totalBytes: number, workspaceId = getWorkspaceId()): Promise<ImportSession> {
  const response = await apiFetch(workspacePath(workspaceId, "imports"), jsonInit("POST", { source: "notion", item_count: itemCount, total_bytes: totalBytes }, {}));
  return parseJsonOrThrow<ImportSession>(response, "가져오기를 시작하지 못했어요.");
}

export async function completeImport(
  importId: string,
  counts: { created: number; failed: number; skipped: number },
  workspaceId = getWorkspaceId()
): Promise<{ import_id: string; status: string; document_count: number }> {
  const response = await apiFetch(importPath(workspaceId, importId, "complete"), jsonInit("POST", counts, {}));
  return parseJsonOrThrow(response, "가져오기를 마무리하지 못했어요.");
}

export async function fetchImportIngestEstimate(importId: string, workspaceId = getWorkspaceId()): Promise<ImportIngestEstimate> {
  const response = await apiFetch(importPath(workspaceId, importId, "ingest-estimate"), { cache: "no-store" });
  return parseJsonOrThrow<ImportIngestEstimate>(response, "위키 편입 비용을 계산하지 못했어요.");
}

/**
 * 아직 편입하지 않은 가져온 문서를 앞에서부터 20개까지 편입 대기열에 넣는다.
 * remaining이 0이 될 때까지 다시 부른다(runIngestLoop).
 */
export async function startImportIngest(importId: string, workspaceId = getWorkspaceId()): Promise<{ queued: number; remaining: number }> {
  const response = await apiFetch(importPath(workspaceId, importId, "ingest"), { method: "POST" });
  return parseJsonOrThrow(response, "위키 편입을 시작하지 못했어요.");
}

/** 가져오기 쓰기 요청 묶음. 같은 import_id·같은 zip 경로는 같은 Idempotency-Key라 재시도가 안전하다. */
export function importWriter(importId: string, workspaceId: string, signal?: AbortSignal) {
  const headers = (idempotencyKey: string) => ({ [IMPORT_ID_HEADER]: importId, "Idempotency-Key": idempotencyKey });
  return {
    async createFolder(name: string, parentFolderId: string | null, idempotencyKey: string): Promise<CreatedFolder> {
      const response = await apiFetch(
        workspacePath(workspaceId, "folders"),
        jsonInit("POST", { name, parent_folder_id: parentFolderId }, headers(idempotencyKey), signal)
      );
      return parseJsonOrThrow<CreatedFolder>(response, "폴더를 만들지 못했어요.");
    },
    async createDocument(displayName: string, markdown: string, folderId: string | null, idempotencyKey: string): Promise<CreatedDocument> {
      const response = await apiFetch(
        workspacePath(workspaceId, "documents", "markdown"),
        jsonInit("POST", { display_name: displayName, markdown, folder_id: folderId }, headers(idempotencyKey), signal)
      );
      return parseJsonOrThrow<CreatedDocument>(response, "문서를 만들지 못했어요.");
    },
    /**
     * 본문 저장. 이미지가 있으면 metadata + attachment_<uuid> part, 없으면 markdown part + base_revision.
     * 이미지 없는 저장의 revision_write_id는 재시도에도 같은 값을 쓴다(writeId).
     */
    async saveContent(
      documentId: string,
      markdown: string,
      baseVersion: number,
      attachments: { id: string; file: File }[],
      writeId: string
    ): Promise<SavedContent> {
      const formData = new FormData();
      if (attachments.length > 0) {
        formData.append("metadata", JSON.stringify({ markdown, base_version: baseVersion }));
        attachments.forEach(({ id, file }) => formData.append(`attachment_${id}`, file, file.name || "image"));
      } else {
        formData.append("markdown", new Blob([markdown], { type: "text/plain;charset=UTF-8" }), "content.md");
        formData.append("base_revision", String(baseVersion));
        formData.append("revision_write_id", writeId);
      }
      const response = await apiFetch(workspacePath(workspaceId, "documents", documentId, "content"), {
        method: "PUT",
        headers: { [IMPORT_ID_HEADER]: importId },
        body: formData,
        signal
      });
      return parseJsonOrThrow<SavedContent>(response, "문서 본문을 저장하지 못했어요.");
    }
  };
}

export type ImportWriter = ReturnType<typeof importWriter>;
