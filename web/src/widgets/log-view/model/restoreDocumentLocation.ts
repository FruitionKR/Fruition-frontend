import { fetchDocuments } from "@/entities/document";
import { fetchTrashDocuments } from "@/entities/document/api/trash";
import type { RestoreDocumentLocation } from "@/entities/operation-log";

/** 되돌리지 못한 작업의 문서 위치. 살아 있는 목록과 휴지통 어디에도 없어야 영구 삭제로 본다. 목록을 못 읽으면(휴지통 권한 등) 모른다고 답한다. */
export async function fetchRestoreDocumentLocation(documentId: string): Promise<RestoreDocumentLocation> {
  try {
    const [documents, trash] = await Promise.all([fetchDocuments(), fetchTrashDocuments()]);
    if (documents.some((document) => document.id === documentId)) return "live";
    return trash.some((document) => document.id === documentId) ? "trash" : "purged";
  } catch {
    return "unknown";
  }
}
