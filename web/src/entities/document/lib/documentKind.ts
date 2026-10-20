import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { DocumentStatus, TreeItem } from "@/entities/tree/model/tree";

/** 업로드를 허용하는 확장자. 파일 선택·드롭 검사에서 함께 쓴다(.markdown은 제외). */
export const SUPPORTED_UPLOAD_EXTENSIONS = [".pdf", ".md", ".txt"] as const;

export function hasMarkdownExtension(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

export function hasPdfExtension(name: string): boolean {
  return /\.pdf$/i.test(name);
}

export function hasTextExtension(name: string): boolean {
  return /\.txt$/i.test(name);
}

export function isPdfDocument(document: DocumentItemResponse): boolean {
  return document.mime_type === "application/pdf" || hasPdfExtension(document.filename);
}

export function isMarkdownDocument(document: DocumentItemResponse): boolean {
  return document.document_role === "EDITABLE"
    && (document.mime_type.includes("markdown") || hasMarkdownExtension(document.filename));
}

/** Markdown은 직접 편입하고 PDF는 확인 후 변환을 거친다. */
export function isMarkdownTreeItem(item: TreeItem): boolean {
  if (item.mimeType?.includes("markdown")) return true;
  return hasMarkdownExtension(item.label);
}

export function isPdfTreeItem(item: TreeItem): boolean {
  return item.mimeType === "application/pdf" || hasPdfExtension(item.label);
}

/**
 * 업로드 직후부터 파이프라인 처리 중까지, 아직 종결되지 않은 문서 상태인지.
 * 완료·실패 알림의 "이전에 끝나지 않았던 문서" 판정용이다. uploaded는 사용자가 편입을 미루면 계속 머물 수 있어
 * 폴링 주기에는 isDocumentPipelineActive를 쓴다.
 */
export function isDocumentInFlight(status: DocumentStatus | undefined): boolean {
  return status === "processing" || status === "uploaded";
}

// 처리 단계가 아직 끝나지 않은 processing_state. stalled는 heartbeat가 끊긴 것일 뿐 실패 확정이 아니다.
const ACTIVE_PIPELINE_STATES: readonly string[] = ["starting", "running", "stalled"];

/**
 * 파이프라인(위키 편입·PDF 변환)이 실제로 돌고 있는 문서인지. 이런 문서가 있을 때만 문서 목록·그래프를 짧은 주기로 폴링한다.
 * 편입을 시작하지 않은 uploaded 문서는 서버에서 저절로 바뀌지 않으므로 대기 상태로 본다.
 */
export function isDocumentPipelineActive(document: Pick<DocumentItemResponse, "status" | "processing_state">): boolean {
  return document.status === "processing"
    || (document.processing_state !== undefined && ACTIVE_PIPELINE_STATES.includes(document.processing_state));
}

/** PDF 변환이 진행 중인 문서인지. 변환 중에는 서버가 묶음마다 본문을 이어 붙여 편집 저장을 거부한다. */
export function isDocumentConverting(document: Pick<DocumentItemResponse, "status" | "pipeline_run_id"> | undefined): boolean {
  return document?.status === "processing" && document.pipeline_run_id?.startsWith("convert:") === true;
}
