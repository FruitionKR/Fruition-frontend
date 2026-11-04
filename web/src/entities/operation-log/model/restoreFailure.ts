import { ApiError, getErrorMessage } from "@/shared/lib/apiErrors";
import type { OperationLogDetail } from "./operationLog";

/** 되돌릴 작업의 문서가 지금 어디 있는지. unknown은 확인하지 못한 것이고, 그때는 영구 삭제로 단정하지 않는다. */
export type RestoreDocumentLocation = "live" | "trash" | "purged" | "unknown";

const RESTORE_FAILURE_FALLBACK = "롤백 요청에 실패했습니다.";
const PURGED_DOCUMENT_MESSAGE = "영구 삭제된 문서의 변경은 되돌릴 수 없어요.";
const TRASHED_DOCUMENT_MESSAGE = "문서가 휴지통에 있어 되돌릴 수 없어요. 휴지통에서 복구한 뒤 다시 시도해 주세요.";
const MISSING_DOCUMENT_MESSAGE = "문서를 찾을 수 없어 되돌릴 수 없어요.";
/** 서버 문구 끝에 붙는 내부 식별자(document DocumentRestorePlanner). */
const INTERNAL_ID_SUFFIX = /:\s*(?:operationId|documentId|revision)=\S+$/;

export function restoreTargetDocumentId(detail: Pick<OperationLogDetail, "target_document_id" | "changes">): string | null {
  return detail.target_document_id ?? detail.changes.find((change) => change.resource_type === "document")?.resource_id ?? null;
}

/**
 * 문서 위치를 확인해야 이유를 말할 수 있는 실패인지. 서버는 휴지통 문서와 영구 삭제 문서를 똑같이 404로 거절하고,
 * 영구 삭제로 Wiki 페이지까지 사라진 작업은 400으로 거절한다.
 */
export function shouldCheckRestoreDocument(error: unknown, documentId: string | null): boolean {
  if (!documentId || !(error instanceof ApiError)) return false;
  return (error.status === 404 && error.code === "DOCUMENT_NOT_FOUND") || (error.status === 400 && error.code === "INVALID_RESTORE_REQUEST");
}

/**
 * 인제스트 작업은 항상 문서를 대상으로 시작하므로, 문서 ID가 비었는데 표시 이름이 남은 행은 문서가 영구 삭제된 것이다(FK ON DELETE SET NULL).
 * 표시 이름도 없으면 어떤 문서였는지 몰라 단정하지 않는다.
 */
export function isPurgedIngestRestore(error: unknown, detail: Pick<OperationLogDetail, "operation_type" | "target_document_id" | "target_display_name"> | null): boolean {
  if (!detail || !(error instanceof ApiError) || error.status !== 400 || error.code !== "INVALID_RESTORE_REQUEST") return false;
  return detail.operation_type === "ingest" && detail.target_document_id === null && Boolean(detail.target_display_name);
}

/** 롤백 실패 안내. location은 shouldCheckRestoreDocument가 참일 때 확인한 문서 위치이고, 확인하지 않았으면 null이다. */
export function restoreFailureMessage(error: unknown, location: RestoreDocumentLocation | null): string {
  if (location === "purged") return PURGED_DOCUMENT_MESSAGE;
  if (location === "trash") return TRASHED_DOCUMENT_MESSAGE;
  if (location === "unknown" && error instanceof ApiError && error.status === 404) return MISSING_DOCUMENT_MESSAGE;
  return getErrorMessage(error, RESTORE_FAILURE_FALLBACK).replace(INTERNAL_ID_SUFFIX, "");
}
