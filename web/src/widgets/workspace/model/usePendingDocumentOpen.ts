import { useEffect, useState } from "react";
import { subscribeConvertStarted, type DocumentItemResponse } from "@/entities/document";
import type { Project } from "@/entities/tree";
import type { ChatWikiExportResponse } from "@/features/wiki-export";
import { findTreeItemInProjects } from "../lib/treeLookup";
import type { TreeSelectionState, useTreeSelection } from "./useTreeSelection";

/**
 * 뒤늦게 목록에 나타나는 문서(채팅 편입 결과·PDF→Markdown 변환 완료)를 홈 화면에 자동으로 연다.
 * 문서 목록과 트리가 모두 갱신돼 트리 항목을 찾을 수 있을 때 한 번 연다.
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
  const [pendingConvertDocumentIds, setPendingConvertDocumentIds] = useState<readonly string[]>([]);

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

  // 어떤 경로로 변환을 시작했든(사이드바 메뉴·그래프/문서 화면 위키 반영) 시작 이벤트로 추적한다.
  // 병렬 변환도 각각 자동으로 열리도록 대기 목록으로 쌓는다.
  useEffect(() => subscribeConvertStarted((documentId) => {
    setPendingConvertDocumentIds((ids) => (ids.includes(documentId) ? ids : [...ids, documentId]));
  }), []);

  // PDF→Markdown 변환 완료를 폴링 결과로 감지해 변환된 markdown 문서를 홈 화면에 연다.
  // 한 실행에 하나만 열고, 나머지 완료 건은 대기 목록 변경으로 재실행될 때 처리한다.
  useEffect(() => {
    for (const pendingDocumentId of pendingConvertDocumentIds) {
      const convertedDocument = documents.find((document) => document.id === pendingDocumentId);
      if (!convertedDocument) continue;
      // 실패 시 열기는 포기한다. 실패 알림은 DocumentProcessingNotifications가 담당한다.
      if (convertedDocument.status === "failed") {
        setPendingConvertDocumentIds((ids) => ids.filter((id) => id !== pendingDocumentId));
        continue;
      }
      if (convertedDocument.status !== "completed") continue;
      const convertedTreeItem = findTreeItemInProjects(projects, pendingDocumentId);
      if (!convertedTreeItem) continue;
      setPendingConvertDocumentIds((ids) => ids.filter((id) => id !== pendingDocumentId));
      openDocument(selection.selectTreeGraphNode(convertedTreeItem));
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openDocument는 선택 상태 setter와 라우터만 쓴다
  }, [documents, pendingConvertDocumentIds, projects, selection]);

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
