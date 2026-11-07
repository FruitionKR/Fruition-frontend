import type { DocumentItemResponse, DocumentUploadResponse } from "@/entities/document/model/document";
import { isMarkdownDocument } from "@/entities/document/lib/documentKind";
import { getWikiReflectState } from "./wikiReflectState";

/**
 * 워크스페이스 설정 auto_ingest_on_upload 하나가 Markdown·txt 업로드 직후와 PDF 변환 직후의 서버 자동 편입을 함께 켠다.
 * 화면은 설정이 꺼져 있어도 Markdown 업로드는 바로 편입하고(프론트가 요청), PDF 변환본은 열 때 편입할지 묻는다.
 * serverAutoIngest: 설정값. null은 워크스페이스 정보를 아직 받지 못한 상태라 서버와 겹칠 수 있어 아무것도 하지 않는다.
 * canIngest: 본인의 wiki.ingest 권한(hasWorkspacePermission 결과). 확실히 가졌을 때(true)만 요청한다.
 */
type AutoIngestContext = {
  serverAutoIngest: boolean | null;
  canIngest: boolean | null;
};

/**
 * 일반 업로드로 올린 문서를 프론트가 바로 편입 요청할지. 설정이 켜져 있으면 서버가 이미 편입하므로 다시 보내지 않는다.
 * 편집 가능 Markdown(.md·.txt)만 대상이다. PDF 원본은 변환을 거쳐야 해 여기서 다루지 않는다.
 */
export function shouldAutoIngestUpload(
  uploaded: Pick<DocumentUploadResponse, "document_role" | "mime_type">,
  { serverAutoIngest, canIngest }: AutoIngestContext
): boolean {
  return canIngest === true
    && serverAutoIngest === false
    && uploaded.document_role === "EDITABLE"
    && uploaded.mime_type !== "application/pdf";
}

/**
 * 화면에 연 PDF 변환본에 "위키에 편입할까요?"를 물을지.
 * 아직 한 번도 편입하지 않았고 지금 시작할 수 있을 때(not-included)만 묻는다. 변환 중·변환 실패·편입 중·편입 완료는 묻지 않는다.
 * isDismissed: 이번 세션에 이 문서를 거절했는지. isQueued: "변환 후 편입"으로 이미 편입을 기다리는 문서인지.
 */
export function shouldPromptConvertedIngest(
  document: DocumentItemResponse | undefined,
  { serverAutoIngest, canIngest, isDismissed, isQueued }: AutoIngestContext & { isDismissed: boolean; isQueued: boolean }
): boolean {
  if (!document || !document.source_document_id || !isMarkdownDocument(document)) return false;
  // 설정이 켜져 있으면 서버가 변환 직후 편입한다. 변환이 막 끝나 편입이 아직 시작되지 않은 순간에 묻지 않게 뺀다.
  if (canIngest !== true || serverAutoIngest !== false || isDismissed || isQueued) return false;
  return getWikiReflectState(document) === "not-included";
}
