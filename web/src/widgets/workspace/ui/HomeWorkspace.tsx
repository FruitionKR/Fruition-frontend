"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ROOT_DOCUMENTS_TITLE } from "@/entities/tree/lib/projectsFromServerTree";
import { AgentLauncher } from "@/widgets/agent-panel/ui/AgentLauncher";
import { AgentPanel } from "@/widgets/agent-panel/ui/AgentPanel";
import { DocumentSidebar } from "@/widgets/document-sidebar/ui/DocumentSidebar";
import { PermissionDialog } from "@/widgets/document-sidebar/ui/PermissionDialog";
import { Graph } from "@/widgets/graph/ui/Graph";
import { SkillRunCoach, SkillsView } from "@/widgets/skills-view";
import { LogView } from "@/widgets/log-view";
import { NotificationsView, useNotificationFeed } from "@/widgets/notifications-view";
import { AccessCodeSettingsPanel } from "@/features/access-code-settings";
import { SettingsContent, SettingsNav, takeSettingsResume, type SettingsResume } from "@/features/user-settings";
import { DocumentProcessingNotifications } from "@/features/document-notifications";
import { railItems } from "@/widgets/rail-navigation/ui/RailNavigation";
import { UploadErrorModal } from "@/features/document-upload/ui/UploadErrorModal";
import { DeleteConfirmModal } from "@/shared/ui/modal/DeleteConfirmModal";
import { BulkDeleteConfirmModal } from "@/shared/ui/modal/BulkDeleteConfirmModal";
import { MergeConfirmModal } from "@/shared/ui/modal/MergeConfirmModal";
import { SourcePreviewPanel } from "@/widgets/source-preview/ui/SourcePreviewPanel";
import { cx } from "@/shared/lib/classNames";
import { useBackdropClick } from "@/shared/hooks/useBackdropClick";
import { useBackendData } from "../model/useBackendData";
import { useDocumentUpload } from "@/features/document-upload/model/useDocumentUpload";
import { useProjectTree } from "../model/useProjectTree";
import type { DeletedTreeIds } from "../lib/deletedTreeIds";
import { getSelectionLocation, useTreeSelection, type TreeSelectionState } from "../model/useTreeSelection";
import {
  getSettingsSection,
  getWorkspaceLocationKey,
  isDocumentLocation,
  WORKSPACE_HOME_LOCATION,
  type WorkspaceLocation
} from "../lib/workspaceLocation";
import { useTreeOpenState } from "../model/useTreeOpenState";
import { findContextFolderId } from "../lib/treeOpenState";
import { buildGraphFromBackend } from "@/entities/graph/lib/graphBuilder";
import { buildDocumentPathSuffixes } from "@/entities/graph/lib/documentLabels";
import { filterGraphProjects, selectGraphDocuments } from "@/features/wiki-ingest/model/graphDocuments";
import { selectGraphIngestProgressInputs } from "@/features/wiki-ingest/model/graphIngestProgressInputs";
import { usePdfWikiIngest } from "@/features/wiki-ingest/model/usePdfWikiIngest";
import { getChatEvidenceNotice } from "@/features/wiki-ingest/model/wikiReflectState";
import { PdfIngestConfirmModal } from "@/features/wiki-ingest/ui/PdfIngestConfirmModal";
import { isPdfDocument } from "@/entities/document/lib/documentKind";
import { isDocumentBodyLocked, isDocumentReadOnly } from "@/entities/document/lib/documentAccess";
import { uploadDocumentFile } from "@/entities/document";
import { getDocumentConversionView } from "@/entities/document/lib/documentConversion";
import { buildGeneratedMarkdownFilename } from "@/features/agent-chat/lib/agentTurn";
import type { GeneratedMarkdownDraft } from "@/features/agent-chat/lib/agentTurn";
import type { ActiveMarkdownEditContext } from "@/features/agent-chat/lib/markdownEditContext";
import type { InlineEditReviewState } from "@/features/agent-chat/ui/InlineEditReview";
import { createClientId, findTreeItem } from "@/entities/tree";
import { getMarkdownDocumentTitle } from "@/entities/document/lib/noteMarkdown";
import { findFirstSelectableNote, findParentLabel, findTreeItemInProjects } from "../lib/treeLookup";
import { useOperationLogFeed } from "../model/useOperationLogFeed";
import { useWorkspaceNavigation } from "../model/useWorkspaceNavigation";
import { useWorkspacePanels } from "../model/useWorkspacePanels";
import { useWorkspaceDocumentTitle } from "../model/useWorkspaceDocumentTitle";
import { useGraphWikiActions } from "../model/useGraphWikiActions";
import { useSkillRun, type SkillRunRequest } from "../model/useSkillRun";
import { useFolderOrganizePreview } from "../model/useFolderOrganizePreview";
import { FolderOrganizePreview } from "@/features/agent-chat/ui/FolderOrganizePreview";
import { usePendingDocumentOpen } from "../model/usePendingDocumentOpen";
import { AGENT_PANEL_LIMITS, SIDEBAR_MAX_WIDTH, SIDEBAR_RAIL_WIDTH } from "../lib/panelResize";
import { canShowAgentPanel } from "../lib/agentPanelVisibility";
import type { SourceBlockHighlight } from "@/entities/document";
import type { GraphNode } from "@/entities/wiki";
import styles from "./HomeWorkspace.module.css";


export function HomeWorkspace() {
  const { location, locationKey, activeView, isAccessLocked, navigate, openDocument, openTreeItemInNewTab, handleViewChange, forgetDeletedLocation } =
    useWorkspaceNavigation();
  // 설정에서 시작한 소셜 재로그인·워크스페이스 전환을 마치고 돌아오면 설정 화면을 떠났던 자리(탈퇴 확인·멤버 관리)로 다시 연다.
  // 한 번 쓰고 나면 다음 열기부터는 기본 위치다.
  const [settingsResume, setSettingsResume] = useState<SettingsResume | null>(null);
  useEffect(() => {
    const resume = takeSettingsResume();
    if (!resume) return;
    setSettingsResume(resume);
    const section = resume === "members" ? "members" : resume === "email-change" ? "profile" : "account";
    navigate({ kind: "view", view: "settings", section }, "replace");
    // 마운트 때 한 번만 확인한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (activeView !== "settings") setSettingsResume(null);
  }, [activeView]);
  const [markdownEditContext, setMarkdownEditContext] = useState<ActiveMarkdownEditContext | null>(null);
  // 채팅 패널이 받은 편집안을 열린 문서 본문에 제안으로 붙인다(Figma 1571:27625).
  const [editReview, setEditReview] = useState<InlineEditReviewState | null>(null);
  const operationLogFeed = useOperationLogFeed(activeView === "logs");
  // 알림 목록·읽음 상태. 알림 화면 탭의 안 읽음 표시에 쓴다.
  const notificationFeed = useNotificationFeed(activeView === "notifications");
  // 스킬 만들기·상세 시트(Figma 1671:13573 · 1708:3848)가 열렸는지. 열린 동안 스킬 화면에도 채팅 패널을 띄우고,
  // 패널 입력창 위 자리(skillTestRunTarget)에 시트의 "테스트 실행"을 그린다.
  const [isSkillSheetOpen, setIsSkillSheetOpen] = useState(false);
  const [skillTestRunTarget, setSkillTestRunTarget] = useState<HTMLDivElement | null>(null);
  const isSkillSheetShown = activeView === "skills" && isSkillSheetOpen;
  const panels = useWorkspacePanels({ activeView, locationKey, isSkillSheetOpen: isSkillSheetShown });
  const { sidebarLayout, agentPanelLayout, isCompactLayout, isAgentPanelShown } = panels;
  // 시트를 열면 채팅 패널도 연다. 좁은 화면에서는 패널이 시트를 덮으므로 열지 않고 시트 안에 테스트 실행을 둔다.
  const openHomeAgentPanel = panels.openHomeAgentPanel;
  useEffect(() => {
    if (isSkillSheetShown && !isCompactLayout) openHomeAgentPanel();
    // 시트가 열릴 때 한 번만 연다. 그 뒤 사용자가 패널을 닫으면 그대로 둔다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSkillSheetShown]);
  // 채팅 패널의 회의 화면(#148)이 열려 있는지. 그동안은 패널을 닫아도 숨긴 채 마운트해 회의록 흐름을 이어 간다.
  const [hasOpenMeeting, setHasOpenMeeting] = useState(false);
  // useProjectTree가 useBackendData보다 먼저 생성되므로 refreshBackendData를 ref로 주입한다.
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const projectTree = useProjectTree({ refreshRef, onDeleted: handleTreeDeleted });
  // 뷰 전환으로 사이드바 트리가 다시 마운트돼도 폴더 펼침을 유지한다.
  const treeOpen = useTreeOpenState();
  const {
    documents,
    documentsUpdatedAt,
    setDocuments,
    wikiGraph,
    isGraphLoading,
    apiError,
    refreshBackendData
  } = useBackendData({ setProjects: projectTree.setProjects });
  const pdfWikiIngest = usePdfWikiIngest(documents, refreshBackendData, documentsUpdatedAt);
  const wikiActions = useGraphWikiActions({ documents, pdfWikiIngest, refreshBackendData });
  const { wikiActionPending, requestGraphIngest } = wikiActions;
  const graphDocuments = useMemo(() => selectGraphDocuments(documents), [documents]);
  const graphProjects = useMemo(() => filterGraphProjects(projectTree.projects, documents), [projectTree.projects, documents]);
  const documentTitles = useMemo(
    () => new Map(documents.map((document) => [document.id, document.filename])),
    [documents]
  );
  useEffect(() => {
    refreshRef.current = refreshBackendData;
  }, [refreshBackendData]);
  const upload = useDocumentUpload({
    projects: projectTree.projects,
    setProjects: projectTree.setProjects,
    setDocuments,
    setFileDropTarget: projectTree.setFileDropTarget,
    refreshBackendData
  });
  // 같은 이름의 Markdown 문서는 폴더 경로로 구분한다(#150). 그래프 라벨과 미리보기 제목이 같은 접미사를 쓴다.
  const documentPathSuffixes = useMemo(
    () => buildDocumentPathSuffixes(graphDocuments, projectTree.projects),
    [graphDocuments, projectTree.projects]
  );
  const graphData = useMemo(
    () => buildGraphFromBackend(graphDocuments, wikiGraph, documentPathSuffixes),
    [graphDocuments, wikiGraph, documentPathSuffixes]
  );
  const graphIngestProgressInputs = useMemo(() => selectGraphIngestProgressInputs(graphDocuments), [graphDocuments]);
  const selection = useTreeSelection(projectTree.projects, graphData.nodes);
  const isHomeView = activeView === "home";
  const isGraphView = activeView === "graph";
  const isSettingsView = activeView === "settings";
  // 작업 탭 "이 요청을 스킬로 저장"(Figma 1671:13245): 스킬 화면이 받아 새 스킬 탭을 열면 비운다.
  const [skillCreateRequest, setSkillCreateRequest] = useState<{ id: number; text: string } | null>(null);
  const clearSkillCreateRequest = useCallback((id: number) => {
    setSkillCreateRequest((current) => (current?.id === id ? null : current));
  }, []);
  const settingsSection = getSettingsSection(location);
  const hasSourcePreview = Boolean(selection.selectedDocumentTitle);
  // 홈에서 문서가 메인 영역을 채우는 상태(Obsidian식 최근 문서 열람)
  const isDocumentMain = isHomeView && hasSourcePreview;

  const { handleChatDocumentExported, openSavedDocument } = usePendingDocumentOpen({
    documents,
    projects: projectTree.projects,
    selection,
    openDocument,
    refreshBackendData
  });

  const selectedDocumentParentLabel = useMemo(() => {
    if (!selection.selectedTreeItemId) return ROOT_DOCUMENTS_TITLE;
    for (const project of projectTree.projects) {
      const parentLabel = findParentLabel(project.items, selection.selectedTreeItemId, project.title);
      if (parentLabel) return parentLabel;
    }
    return ROOT_DOCUMENTS_TITLE;
  }, [projectTree.projects, selection.selectedTreeItemId]);

  const selectedDocumentStatus = useMemo(() => {
    if (!selection.selectedDocumentId) return undefined;
    return documents.find((item) => item.id === selection.selectedDocumentId)?.status;
  }, [documents, selection.selectedDocumentId]);
  // 서버 can_edit=false인 문서만 읽기 전용이다. 목록에서 아직 못 찾았거나 구 서버 응답이면 편집 가능으로 본다.
  const isSelectedDocumentReadOnly = useMemo(
    () => isDocumentReadOnly(documents.find((item) => item.id === selection.selectedDocumentId)),
    [documents, selection.selectedDocumentId]
  );
  // 채팅 Wiki page화 문서는 권한과 무관하게 본문 편집기(편집 잠금)를 열지 않는다.
  const isSelectedDocumentBodyLocked = useMemo(
    () => isDocumentBodyLocked(documents.find((item) => item.id === selection.selectedDocumentId)),
    [documents, selection.selectedDocumentId]
  );
  const selectedDocumentConversion = useMemo(
    () => getDocumentConversionView(documents.find((item) => item.id === selection.selectedDocumentId)),
    [documents, selection.selectedDocumentId]
  );
  // 채팅이 editorSnapshot으로 함께 보내는 노트. 답변 근거는 위키만 검색하므로 미편입·변경 상태를 안내한다.
  const chatContextDocument = useMemo(
    () => documents.find((document) => document.id === markdownEditContext?.documentId),
    [documents, markdownEditContext?.documentId]
  );
  const chatEvidenceNotice = getChatEvidenceNotice(chatContextDocument);
  const firstSidebarNote = useMemo(() => {
    const documentIds = new Set(documents.map((document) => document.id));
    for (const project of projectTree.projects) {
      const note = findFirstSelectableNote(project.items, documentIds);
      if (note) return note;
    }
    return null;
  }, [documents, projectTree.projects]);

  // 문서 목록·위키 그래프를 모두 받기 전에는 URL의 대상을 "없는 문서"로 판단하지 않는다.
  const isWorkspaceDataReady = documentsUpdatedAt !== 0 && !isGraphLoading && !apiError;
  // 현재 문서를 삭제한 직후의 문서 목록 시각. 그 뒤 재조회가 끝나야 첫 노트를 다시 고른다(삭제된 문서를 다시 열지 않게).
  const staleDocumentsAtRef = useRef(0);
  const selectionLocationKey = selection.selectionLocation ? getWorkspaceLocationKey(selection.selectionLocation) : null;

  /** URL의 문서·위키 페이지·트리 항목을 미리보기 선택으로 연다. 대상을 찾지 못하면 false. */
  function openLocationTarget(target: WorkspaceLocation) {
    if (target.kind === "document") {
      const document = documents.find((item) => item.id === target.documentId);
      if (!document) return false;
      // 트리에 있는 문서면 사이드바 클릭과 같은 경로로 열어 트리 행 강조를 맞춘다.
      const treeItem = findTreeItemInProjects(projectTree.projects, document.id);
      if (treeItem && selection.selectTreeGraphNode(treeItem)) return true;
      selection.openSourceBlockPreview(document.id, document.filename, []);
      return true;
    }
    if (target.kind === "page") {
      const page = wikiGraph.nodes.find((node) => node.id === target.pageId);
      if (!page || (page.page_type !== "source" && page.page_type !== "concept")) return false;
      selection.openWikiPagePreview(page.id, page.title, page.page_type);
      return true;
    }
    if (target.kind === "tree") {
      const item = projectTree.projects.map((project) => findTreeItem(project.items, target.treeItemId)).find(Boolean);
      return Boolean(item && selection.selectTreeGraphNode(item));
    }
    return false;
  }

  // URL이 바뀌면(링크 이동·뒤로/앞으로·새 탭) 미리보기 선택을 그 대상으로 맞춘다.
  // 열기 동작은 선택을 먼저 바꾸고 URL로 이동하므로, 이미 같은 대상이면 그대로 둔다(근거 하이라이트 유지).
  // 편집기는 문서가 바뀌면 다시 마운트되며, 언마운트 때 대기 중 저장을 즉시 보내고 편집 잠금을 푼다(문서 전환과 같은 경로).
  // 그림 전에 맞춰 이전 문서가 한 프레임 보이지 않게 layout effect로 둔다.
  useLayoutEffect(() => {
    // 같은 문서가 이미 열려 있어도, 트리가 늦게 들어와 트리 행과 연결되지 않았다면 다시 맞춰 사이드바 강조를 잇는다.
    const isMissingTreeLink = location.kind === "document" && selection.selectedTreeItemId === null
      && findTreeItemInProjects(projectTree.projects, location.documentId) !== null;
    if (location.kind === "view" || (selectionLocationKey === locationKey && !isMissingTreeLink)) return;
    if (!isWorkspaceDataReady || documentsUpdatedAt <= staleDocumentsAtRef.current) return;
    if (location.kind === "home") {
      // 파라미터 없는 /home: 첫 노트를 열고 그 문서 URL로 바꾼다(히스토리를 쌓지 않게 replace).
      const opened = firstSidebarNote ? selection.selectTreeGraphNode(firstSidebarNote) : null;
      const target = opened && getSelectionLocation(opened);
      if (target) navigate(target, "replace");
      else selection.clearTreeGraphSelection();
      return;
    }
    // 없는 문서·페이지면 빈 화면으로 둔다. 데이터가 갱신되면(트리 병합·재조회) 다시 찾아본다.
    if (!openLocationTarget(location)) selection.clearTreeGraphSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL·데이터가 바뀔 때만 맞춘다. 선택 변경마다 되돌리면 그래프 포커스가 풀린다
  }, [locationKey, isWorkspaceDataReady, documentsUpdatedAt, firstSidebarNote, projectTree.projects, wikiGraph]);

  // 그래프 화면으로 들어오면(세그먼트·뒤로가기 등 어떤 경로든) 다른 화면에서 연 문서의 포커스가 그래프 선택으로 이어지지 않게 한다.
  // 그래프 화면 안에서의 노드 선택(사이드바·더블클릭)은 URL을 바꾸지 않아 영향 없다.
  useEffect(() => {
    if (location.kind === "view" && location.view === "graph") selection.clearGraphFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 화면 전환 때만 지운다
  }, [locationKey]);

  // 사이드바·채팅에서 고른 대상: 그래프 화면에서는 그래프 포커스만 옮기고(기존 동작), 그 외에는 문서 화면에서 연다.
  function openSelectedPreview(opened: TreeSelectionState | null) {
    if (isGraphView) return;
    openDocument(opened);
  }

  // 열린 문서나 그 상위 폴더가 삭제되면 문서 화면은 /home(첫 노트)으로 바꾸고, 그래프 화면은 선택(포커스)만 지운다.
  function handleTreeDeleted({ documentIds, treeItemIds }: DeletedTreeIds) {
    const isDeleted = (target: WorkspaceLocation | null) =>
      (target?.kind === "document" && documentIds.includes(target.documentId))
      || (target?.kind === "tree" && treeItemIds.includes(target.treeItemId));
    const isLocationDeleted = forgetDeletedLocation(isDeleted);
    const { selectedDocumentId, selectedTreeItemId } = selection;
    const isSelectionDeleted = (selectedDocumentId !== null && documentIds.includes(selectedDocumentId))
      || (selectedTreeItemId !== null && treeItemIds.includes(selectedTreeItemId));
    if (isSelectionDeleted) selection.clearTreeGraphSelection();
    if (isHomeView && (isSelectionDeleted || isLocationDeleted)) {
      staleDocumentsAtRef.current = documentsUpdatedAt;
      navigate(WORKSPACE_HOME_LOCATION, "replace");
    }
  }

  // 트리 이름 변경이 바로 보이도록 선택 상태의 최신 트리 이름을 쓴다.
  const selectedDocumentLabel = selection.selectedDocumentTitle
    ? getMarkdownDocumentTitle(selection.selectedDocumentTitle)
    : null;
  // 데이터를 다 받았는데도 URL의 문서를 열지 못했으면 빈 화면 문구로 알려준다.
  const isMissingDocument = isHomeView && isDocumentLocation(location) && isWorkspaceDataReady && !selectedDocumentLabel;
  const screenTitle = isHomeView
    ? selectedDocumentLabel
    : railItems.find((item) => item.id === activeView)?.label ?? null;
  useWorkspaceDocumentTitle(screenTitle, locationKey);

  function openSourceBlocks(documentId: string, title: string, highlights: SourceBlockHighlight[]) {
    const documentTitle = documents.find((document) => document.id === documentId)?.filename ?? title;
    return selection.openSourceBlockPreview(documentId, documentTitle, highlights);
  }

  // 그래프 노드 더블클릭: 원본(raw) 노드는 문서 탭으로 열고, 그 외 노드는 그래프 포커스만 옮긴다.
  function openGraphNode(node: GraphNode) {
    if (node.kind === "raw" && node.documentId) {
      openDocument(openSourceBlocks(node.documentId, node.label, []));
      return;
    }
    selection.openGraphNodePreview(node);
  }

  async function createGeneratedMarkdownDocument(draft: GeneratedMarkdownDraft, folderId: string | null) {
    const noteId = createClientId("ai-note");
    const body = draft.markdown.endsWith("\n") ? draft.markdown : `${draft.markdown}\n`;
    const file = new File(
      [`<!-- fruition-note: ${noteId} -->\n${body}`],
      buildGeneratedMarkdownFilename(draft.title),
      { type: "text/markdown" }
    );
    // folderId는 turn의 작업 대상 폴더(folder_id)다. 없으면 루트에 만든다.
    const created = await uploadDocumentFile(file, folderId).catch(async (error: unknown) => {
      // AI가 만든 문서 업로드가 실패해도 최신 목록을 보여 준다.
      await refreshBackendData().catch(() => {});
      throw error;
    });
    setDocuments((current) => [
      ...current.filter((document) => document.id !== created.id),
      created
    ]);
    void refreshBackendData();
    openDocument(selection.openSourceBlockPreview(created.id, created.filename, []));
  }

  // 대상을 고른 스킬 실행. 채팅 패널이 작업 탭으로 한 번 보내고 onSkillRunSent로 비운다.
  const [skillRunRequest, setSkillRunRequest] = useState<SkillRunRequest | null>(null);
  const skillRunState = useSkillRun({
    activeView,
    projects: projectTree.projects,
    documents,
    onStart: panels.expandSidebar,
    onConfirmed: (request) => {
      const { target } = request;
      handleViewChange("home");
      panels.openHomeAgentPanel();
      if (target.kind === "document") {
        const filename = documents.find((document) => document.id === target.documentId)?.filename ?? target.label;
        openDocument(selection.openSourceBlockPreview(target.documentId, filename, []));
      }
      setSkillRunRequest(request);
    }
  });
  const { skillRun } = skillRunState;
  const folderOrganize = useFolderOrganizePreview({ locationKey, isHomeView, goHome: () => handleViewChange("home") });

  // main 배경을 직접 누르고 뗐을 때만 선택 해제. 자식(사이드바 여백·폴더 헤더 등)에서 버블된 클릭이나
  // 편집기에서 드래그해 바깥에서 놓은 클릭까지 해제하면 노트 선택이 풀려 편집기가 비어 보인다.
  // 문서 화면은 URL이 열린 대상을 정하므로 배경 클릭으로 닫지 않는다.
  const workspaceBackgroundClick = useBackdropClick<HTMLElement>(() => {
    if (isGraphView) selection.clearTreeGraphSelection();
  });

  return (
    <main
      ref={panels.workspaceRef}
      className={cx(
        "workspace",
        panels.isSidebarCollapsed && "is-sidebar-collapsed",
        isCompactLayout && "is-compact-layout",
        hasSourcePreview && "has-source-preview",
        isDocumentMain && "is-document-main",
        panels.isPanelResizing && "is-panel-resizing"
      )}
      style={panels.panelStyle}
      {...workspaceBackgroundClick}
      onPointerMove={panels.handleResizePointerMove}
      onPointerUp={panels.handleResizePointerEnd}
      onPointerCancel={panels.handleResizePointerEnd}
    >
      <DocumentSidebar
        projects={isGraphView ? graphProjects : projectTree.projects}
        draggedItemId={projectTree.draggedItem?.itemId ?? null}
        selectedItemId={skillRun ? null : selection.selectedTreeItemId}
        selectedItemIds={skillRun ? new Set(skillRun.target ? [skillRun.target.itemId] : []) : projectTree.selectedItemIds}
        isPickingTarget={skillRun !== null}
        dropTarget={projectTree.dropTarget}
        fileDropTarget={projectTree.fileDropTarget}
        editing={projectTree.editing}
        openIds={treeOpen.openIds}
        onToggleOpen={treeOpen.toggle}
        onOpenMany={treeOpen.openMany}
        contextMenu={projectTree.contextMenu}
        convertContextTarget={projectTree.convertContextTarget}
        canRenameContextTarget={projectTree.canRenameContextTarget}
        canDeleteContextTarget={projectTree.canDeleteContextTarget}
        canSetPermissionContextTarget={projectTree.canSetPermissionContextTarget}
        canCreateInContextTarget={projectTree.canCreateInContextTarget}
        uploadInputRef={upload.uploadInputRef}
        activeView={activeView}
        documents={documents}
        graphActions={{
          documents,
          projects: projectTree.projects,
          pending: wikiActionPending ?? (pdfWikiIngest.isPending ? "ingest" : null),
          onIngestDocuments: requestGraphIngest,
          onLint: () => void wikiActions.handleGraphLint()
        }}
        onViewChange={handleViewChange}
        onOpenSettings={(section) => navigate({ kind: "view", view: "settings", section })}
        settingsNav={isSettingsView && !isAccessLocked ? (
          <SettingsNav activeSection={settingsSection} onSelect={(section) => navigate({ kind: "view", view: "settings", section })} />
        ) : undefined}
        isCollapsed={panels.isSidebarCollapsed}
        isOverlay={isCompactLayout}
        onCollapseSidebar={panels.collapseSidebar}
        onExpandSidebar={panels.expandSidebar}
        onAddProject={() => {
          // 폴더 안에 만들면 새 항목이 보이도록 대상 폴더를 펼친다.
          const folderId = findContextFolderId(projectTree.projects, projectTree.contextMenu);
          if (folderId) treeOpen.open(folderId);
          projectTree.addProject();
        }}
        resizeHandle={{
          valueNow: sidebarLayout.visibleWidth,
          valueMin: SIDEBAR_RAIL_WIDTH,
          valueMax: SIDEBAR_MAX_WIDTH,
          onPointerDown: sidebarLayout.start,
          onKeyDown: sidebarLayout.handleKeyDown
        }}
        onUploadPickerChange={upload.handleUploadPickerChange}
        onMoveItem={projectTree.moveTreeEntry}
        onDropFiles={upload.dropUploadFiles}
        onDragStart={projectTree.onDragStart}
        onToggleSelectItem={skillRun ? skillRunState.pickSkillTarget : projectTree.toggleSelectedItem}
        onSelectItemRange={projectTree.selectItemRange}
        onClearSelectedItems={projectTree.clearSelectedItems}
        onDeleteSelectedItems={projectTree.deleteSelectedItems}
        selectedContextCount={skillRun ? 0 : projectTree.selectedContextCount}
        onDragOverItem={projectTree.onDragOverItem}
        onFileDragOver={projectTree.setFileDropTarget}
        onFileDragLeave={projectTree.onFileDragLeave}
        onDragEnd={projectTree.onDragEnd}
        onContextMenuProject={projectTree.openProjectMenu}
        onContextMenuItem={projectTree.openFolderMenu}
        onOpenFolderMenuAt={projectTree.openFolderMenuAt}
        onSelectGraphNode={(item) => openSelectedPreview(selection.selectTreeGraphNode(item))}
        onOpenInNewTab={openTreeItemInNewTab}
        onEditingChange={projectTree.onEditingChange}
        onCommitEditing={projectTree.commitEditing}
        onCancelEditing={projectTree.cancelEditing}
        onRenameContextTarget={projectTree.renameContextTarget}
        onSetPermissionContextTarget={projectTree.openPermissionContextTarget}
        onAddMarkdownFromContext={() => {
          const target = projectTree.takeFolderTargetFromContext();
          if (target?.folderId) treeOpen.open(target.folderId);
          if (target) void upload.createMarkdownFile(target.projectId, target.folderId);
        }}
        onCreateNote={(projectId) => {
          // 최상위에 새 노트를 만들고, 업로드가 끝나면 바로 편집 화면으로 연다. 실패는 트리 행이 실패 상태로 보여 준다.
          void upload.createMarkdownFile(projectId, null).then((created) => {
            if (created) openDocument(selection.openSourceBlockPreview(created.id, created.filename, []));
          });
        }}
        onUploadFromContext={() => {
          const target = projectTree.takeFolderTargetFromContext();
          if (target?.folderId) treeOpen.open(target.folderId);
          if (target) upload.openUploadPicker(target.projectId, target.folderId);
        }}
        onConvertContextTarget={projectTree.convertContextTargetToMarkdown}
        onDeleteContextTarget={projectTree.deleteContextTarget}
        onCloseContextMenu={projectTree.closeContextMenu}
      />

      {/* 좁은 화면에서 겹쳐 연 사이드바 바깥을 누르면 닫는다. 스킬 대상을 고르는 동안에는 안내의 버튼을 가리지 않게 두지 않는다. */}
      {isCompactLayout && panels.isCompactSidebarOpen && !skillRun && (
        <button type="button" tabIndex={-1} className="compact-sidebar-backdrop" aria-label="사이드바 닫기" onClick={panels.collapseSidebar} />
      )}

      {isHomeView && apiError && (
        <div className="workspace-api-error" role="alert">
          <span>{apiError}</span>
          <button type="button" onClick={() => void refreshBackendData()}>다시 시도</button>
        </div>
      )}

      {/* 홈: URL의 문서를 메인으로 여는 문서 열람 화면. 열 문서가 없으면 빈 화면. */}
      {isHomeView && (
        selection.selectedDocumentTitle && selectedDocumentLabel ? (
          <SourcePreviewPanel
            title={selection.selectedDocumentTitle}
            pageId={selection.selectedPreviewTarget?.pageId ?? null}
            pageType={selection.selectedPreviewTarget?.pageType ?? null}
            documentId={selection.selectedDocumentId}
            sourceBlockHighlights={selection.selectedPreviewTarget?.sourceBlockHighlights ?? []}
            onMarkdownEditContextChange={setMarkdownEditContext}
            editReview={editReview}
            onRenameDocument={projectTree.renameDocumentById}
            onRefreshDocuments={() => void refreshBackendData()}
            documentStatus={selectedDocumentStatus}
            readOnly={isSelectedDocumentReadOnly}
            bodyLocked={isSelectedDocumentBodyLocked}
            documentConversion={selectedDocumentConversion}
            titleHint={`${selectedDocumentParentLabel} / ${selectedDocumentLabel}`}
            titleSuffix={selection.selectedDocumentId ? documentPathSuffixes.get(selection.selectedDocumentId) : undefined}
            fillMain
          />
        ) : (
          <section className="blank-view" aria-label="홈 빈 화면">
            {isMissingDocument && <p className={styles["blank-view-message"]} role="status">문서를 찾을 수 없습니다</p>}
          </section>
        )
      )}

      {/* 폴더 정리 스킬 결과는 문서 화면 위에 미리보기 탭으로 띄운다(Figma 1656:11542). 문서 편집 결과는 채팅의 편집 미리보기를 쓴다. */}
      {isHomeView && folderOrganize.request && (
        <FolderOrganizePreview key={folderOrganize.request.turnId} request={folderOrganize.request} onClose={folderOrganize.close} />
      )}

      {/* 그래프: ?view=graph일 때 그래프 화면을 보여준다. */}
      {isGraphView && (
        <Graph
          nodes={graphData.nodes}
          links={graphData.links}
          rawDocumentCount={graphDocuments.length}
          focusedNodeId={selection.focusedGraphNodeId}
          onOpenNodePreview={openGraphNode}
          onClearNodeFocus={selection.clearGraphFocus}
          loading={isGraphLoading}
          errorMessage={apiError}
          ingestProgressInputs={graphIngestProgressInputs}
        />
      )}

      {wikiActions.pdfIngestConfirmation && (
        <PdfIngestConfirmModal
          pdfCount={wikiActions.pdfIngestConfirmation.filter(isPdfDocument).length}
          onCancel={wikiActions.cancelPdfIngest}
          onConfirm={wikiActions.confirmPdfIngest}
        />
      )}

      {/* 채팅 패널이 닫혀 있으면 우하단 원형 버튼으로 연다 (Figma 1426:15877 / 1406:14202). */}
      {!isAgentPanelShown && canShowAgentPanel(activeView) && (
        <AgentLauncher onOpen={panels.openAgentPanel} />
      )}

      {/* 채팅 패널 폭 조절 핸들: 왼쪽으로 끌면 넓어지고, 최소 폭 미만이면 패널을 닫는다. ←/→ 16px, Enter 닫기 */}
      {isAgentPanelShown && !isCompactLayout && (
        <div
          role="separator"
          tabIndex={0}
          className={cx("agent-panel-resize-handle", agentPanelLayout.isDragging && "is-dragging")}
          aria-label="채팅 패널 폭 조절"
          aria-orientation="vertical"
          aria-valuenow={agentPanelLayout.visibleWidth}
          aria-valuemin={AGENT_PANEL_LIMITS.min}
          aria-valuemax={agentPanelLayout.maxWidth}
          aria-valuetext={`${agentPanelLayout.visibleWidth}px`}
          onPointerDown={agentPanelLayout.start}
          onKeyDown={agentPanelLayout.handleKeyDown}
        />
      )}

      {/* 스킬·알림 등 패널이 없는 화면으로 가도 열려 있던 패널은 숨겨서 유지한다.
          돌아올 때 대화·모델 목록을 다시 받느라 비었다 채워지는(새로고침처럼 보이는) 것을 막는다. */}
      {(panels.isAgentPanelOpen || hasOpenMeeting) && (
        <div className={cx("agent-panel-host", !isAgentPanelShown && "is-hidden")}>
        <AgentPanel
          isShown={isAgentPanelShown}
          onClose={panels.closeAgentPanel}
          onOpenSourceBlocks={(documentId, title, highlights) => openSelectedPreview(openSourceBlocks(documentId, title, highlights))}
          onCreateMarkdownDocument={createGeneratedMarkdownDocument}
          markdownEditContext={markdownEditContext}
          openDocumentTitle={chatContextDocument ? getMarkdownDocumentTitle(chatContextDocument.filename) : null}
          onEditReviewChange={setEditReview}
          onDocumentExported={handleChatDocumentExported}
          onMeetingNotesSaved={openSavedDocument}
          onMeetingActiveChange={setHasOpenMeeting}
          onOpenFolderOrganize={folderOrganize.open}
          nodes={graphData.nodes}
          skillRun={skillRunRequest && {
            id: skillRunRequest.id,
            message: skillRunRequest.message,
            documentId: skillRunRequest.target.kind === "document" ? skillRunRequest.target.documentId : null,
            folderId: skillRunRequest.folderId,
            documentFolderId: skillRunRequest.target.kind === "document" ? skillRunRequest.target.parentFolderId : null
          }}
          onSkillRunSent={(id) => setSkillRunRequest((current) => (current?.id === id ? null : current))}
          onManageSkills={() => handleViewChange("skills")}
          skillTestRunSlotRef={isSkillSheetShown ? setSkillTestRunTarget : undefined}
          onSaveRequestAsSkill={(request) => {
            // 스킬 화면으로 옮기고, 그 요청으로 채운 새 스킬 탭(prefillRequest)을 연다.
            setSkillCreateRequest({ id: Date.now(), text: request });
            handleViewChange("skills");
          }}
          wikiEvidenceNotice={chatContextDocument && chatEvidenceNotice ? {
            ...chatEvidenceNotice,
            // handleGraphIngest는 다른 위키 작업이 진행 중이면 요청을 무시하므로 그동안 버튼을 막는다.
            isDisabled: wikiActionPending !== null || pdfWikiIngest.isPending,
            isIngesting: wikiActionPending === "ingest" && wikiActions.ingestTargetIds.includes(chatContextDocument.id),
            onIngest: () => requestGraphIngest([chatContextDocument])
          } : null}
        />
        </div>
      )}

      {!isHomeView && !isGraphView && (
        activeView === "skills" ? (
          <SkillsView
            onRunSkill={skillRunState.startSkillRun}
            createRequest={skillCreateRequest}
            onCreateRequestHandled={clearSkillCreateRequest}
            onSheetOpenChange={setIsSkillSheetOpen}
            testRunTarget={isAgentPanelShown ? skillTestRunTarget : null}
          />
        ) : activeView === "logs" ? (
          <LogView
            feed={operationLogFeed}
            operationId={operationLogFeed.selectedOperationId}
            restoredOperationIds={operationLogFeed.restoredOperationIds}
            documentTitles={documentTitles}
            onRestoreComplete={operationLogFeed.refresh}
          />
        ) : activeView === "notifications" ? (
          <NotificationsView
            feed={notificationFeed}
            onOpenOperation={(operationId) => {
              // 로그 화면이 열리며 목록을 받을 때 이 작업을 그대로 고르도록 먼저 선택해 둔다.
              operationLogFeed.onSelect(operationId);
              navigate({ kind: "view", view: "logs" });
            }}
          />
        ) : isSettingsView ? (
          // 접근 코드가 잠겨 있으면 개인 설정(접근 코드) 화면만, 아니면 설정 화면(Figma 1540:22452)
          isAccessLocked ? <AccessCodeSettingsPanel /> : (
            <SettingsContent
              section={settingsSection}
              resume={settingsResume}
              onOpenSection={(section) => navigate({ kind: "view", view: "settings", section })}
            />
          )
        ) : (
          <section className="blank-view" aria-label={`${railItems.find((item) => item.id === activeView)?.label ?? ""} 빈 화면`} />
        )
      )}

      {activeView === "skills" && skillRun && (
        <SkillRunCoach
          hasTarget={skillRun.target !== null}
          errorMessage={skillRun.errorMessage}
          onCancel={skillRunState.cancelSkillRun}
          onNext={skillRunState.confirmSkillRun}
        />
      )}

      {/* 위키 편입 안내 토스트는 문서를 다루는 홈·그래프 화면에서만 보여 준다. 채팅 런처가 떠 있으면 그 위로 비켜 선다. */}
      {(isHomeView || isGraphView) && (
        <DocumentProcessingNotifications
          documents={documents}
          isAboveLauncher={!isAgentPanelShown}
          isOverlayOpen={isCompactLayout && (isAgentPanelShown || panels.isCompactSidebarOpen)}
          onIngestStarted={() => void refreshBackendData().catch(() => {})}
        />
      )}
      {upload.hasRejectedFiles && <UploadErrorModal onConfirm={upload.clearRejectedFiles} />}
      {projectTree.bulkDeleteConfirm && (
        <BulkDeleteConfirmModal
          target={projectTree.bulkDeleteConfirm}
          onConfirm={projectTree.confirmBulkDelete}
          onCancel={projectTree.cancelBulkDelete}
        />
      )}
      {projectTree.deleteConfirm && (
        <DeleteConfirmModal
          target={projectTree.deleteConfirm}
          onConfirm={projectTree.confirmDelete}
          onCancel={projectTree.cancelDelete}
        />
      )}
      {projectTree.permissionTarget && (
        <PermissionDialog
          target={projectTree.permissionTarget}
          onSave={projectTree.applyPermission}
          onClose={projectTree.closePermissionDialog}
        />
      )}
      {projectTree.mergeConfirm && (
        <MergeConfirmModal
          target={projectTree.mergeConfirm}
          onConfirm={projectTree.confirmMerge}
          onCancel={projectTree.cancelMerge}
        />
      )}
    </main>
  );
}
