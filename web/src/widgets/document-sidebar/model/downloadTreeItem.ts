import { fetchDocumentOriginal } from "@/entities/document";
import { hasMarkdownExtension } from "@/entities/document/lib/documentKind";
import type { TreeItem } from "@/entities/tree";
import { publishNotice } from "@/features/document-notifications";
import { fetchNoteDraft, waitForPendingDocumentSave } from "@/features/note-editing";
import { getErrorMessage } from "@/shared/lib/apiErrors";

/** 내려받은 blob URL을 바로 해제하면 일부 브라우저가 저장을 시작하지 못해 잠시 둔다 (ms) */
const OBJECT_URL_REVOKE_DELAY_MS = 1000;

/**
 * 컨텍스트 메뉴 "원본 다운로드": 트리에 보이는 파일명(확장자 포함)으로 원본을 내려받는다.
 * Markdown 노트는 편집본이 원본보다 최신이라 저장 대기 후 편집본(없으면 원본)을 .md로 내려받는다.
 * 실패 알림 문구는 화면 언어로 옮긴 것을 받는다.
 */
export async function downloadTreeItemOriginal(item: TreeItem, failure: { title: string; message: string }): Promise<void> {
  const documentId = item.documentId;
  if (!documentId) return;
  const filename = item.label;
  try {
    const blob = await loadDownloadBlob(documentId, item);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
  } catch (error) {
    publishNotice({ kind: "failed", title: failure.title, message: getErrorMessage(error, failure.message) });
  }
}

async function loadDownloadBlob(documentId: string, item: TreeItem): Promise<Blob> {
  const isMarkdown = hasMarkdownExtension(item.label) || item.mimeType === "text/markdown";
  if (isMarkdown) {
    await waitForPendingDocumentSave(documentId);
    const draft = await fetchNoteDraft(documentId);
    if (draft) return new Blob([draft.markdown], { type: "text/markdown;charset=utf-8" });
  }
  return fetchDocumentOriginal(documentId);
}
