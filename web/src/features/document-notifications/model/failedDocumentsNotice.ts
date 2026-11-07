import { describeDocumentFailure } from "@/shared/lib/aiErrorCodes";
import type { DocumentItemResponse } from "@/entities/document";

type FailedDocumentSummary = Pick<DocumentItemResponse, "filename" | "error_message" | "error_code">;

// 요약 메시지에 나열하는 파일명 상한. 넘치는 문서는 "외 N개"로 줄인다.
const MAX_LISTED_FILENAMES = 3;

/** 실패 알림에 담을 값. 문구는 알림 훅이 언어에 맞춰 만든다. */
export type FailedDocumentsNoticeValues =
  | { type: "single"; filename: string; reason: string | null }
  | { type: "multiple"; count: number; listedFilenames: string[]; restCount: number };

// 대량 실패 시 문서 수만큼 카드가 쌓여 화면 밖으로 밀리지 않도록 실패 문서들을 알림 하나로 묶는다.
export function summarizeFailedDocuments(failedDocuments: FailedDocumentSummary[]): FailedDocumentsNoticeValues {
  if (failedDocuments.length === 1) {
    const [failed] = failedDocuments;
    return { type: "single", filename: failed.filename, reason: describeDocumentFailure(failed.error_message, failed.error_code) ?? null };
  }
  return {
    type: "multiple",
    count: failedDocuments.length,
    listedFilenames: failedDocuments.slice(0, MAX_LISTED_FILENAMES).map((failed) => failed.filename),
    restCount: Math.max(0, failedDocuments.length - MAX_LISTED_FILENAMES)
  };
}
