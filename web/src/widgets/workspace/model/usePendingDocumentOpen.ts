import { useEffect, useState } from "react";
import type { DocumentItemResponse } from "@/entities/document";
import type { Project } from "@/entities/tree";
import type { ChatWikiExportResponse } from "@/features/wiki-export";
import { findTreeItemInProjects } from "../lib/treeLookup";
import type { TreeSelectionState, useTreeSelection } from "./useTreeSelection";

/**
 * 뒤늦게 목록에 나타나는 문서(채팅 편입 결과)를 홈 화면에 자동으로 연다.
 * 문서 목록과 트리가 모두 갱신돼 트리 항목을 찾을 수 있을 때 한 번 연다.
 * PDF 변환 완료는 현재 문서·채팅을 유지한다. 완료 알림을 확인한 사용자가 트리에서 직접 연다.
 */
export function usePendingDocumentOpen({
  documents,
  projects,
  selection,
  openDocument,
  refreshBackendData
}: {
  documents: DocumentItemResponse[];
  projects: Project[];
  selection: ReturnType<typeof useTreeSelection>;
  openDocument: (opened: TreeSelectionState | null) => void;
  refreshBackendData: (options?: { throwOnError?: boolean }) => Promise<void>;
}) {
  const [pendingExportDocumentId, setPendingExportDocumentId] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingExportDocumentId) return;
    const exportedDocument = documents.find((document) => document.id === pendingExportDocumentId);
    if (!exportedDocument) return;
    const exportedTreeItem = findTreeItemInProjects(projects, pendingExportDocumentId);
    if (!exportedTreeItem) return;
    setPendingExportDocumentId(null);
    openDocument(selection.selectTreeGraphNode(exportedTreeItem));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openDocument는 선택 상태 setter와 라우터만 쓴다
  }, [documents, pendingExportDocumentId, projects, selection]);

  async function handleChatDocumentExported(response: ChatWikiExportResponse) {
    await openSavedDocument(response.exportDocumentId);
  }

  /** 채팅 패널이 서버에 만든·고친 문서(채팅 편입 결과, 회의록 저장 #148)를 목록을 새로 받은 뒤 연다. */
  async function openSavedDocument(documentId: string) {
    setPendingExportDocumentId(documentId);
    await refreshBackendData({ throwOnError: true });
  }

  return { handleChatDocumentExported, openSavedDocument };
}
