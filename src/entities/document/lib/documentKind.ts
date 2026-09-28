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

/** 업로드 직후부터 파이프라인 처리 중까지, 아직 종결되지 않은 문서 상태인지. */
export function isDocumentInFlight(status: DocumentStatus | undefined): boolean {
  return status === "processing" || status === "uploaded";
}
