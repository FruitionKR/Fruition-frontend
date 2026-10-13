"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ROOT_DOCUMENTS_TITLE } from "@/entities/tree/lib/serverTree";
import { AgentLauncher } from "@/widgets/agent-panel/ui/AgentLauncher";
import { AgentPanel } from "@/widgets/agent-panel/ui/AgentPanel";
import { DocumentSidebar } from "@/widgets/document-sidebar/ui/DocumentSidebar";
import { PermissionDialog } from "@/widgets/document-sidebar/ui/PermissionDialog";
import { Graph } from "@/widgets/graph/ui/Graph";
import { SkillRunCoach, SkillsView } from "@/widgets/skills-view";
import type { SkillResponse } from "@/entities/skill";
import { LogView } from "@/widgets/log-view";
import { NotificationsView, useNotificationFeed } from "@/widgets/notifications-view";
import { SettingsPanel, useAccessGate } from "@/features/settings";
import {
  DocumentProcessingNotifications,
  fetchWikiMaintenanceStatus,
  publishNotice,
  requestWikiLint
} from "@/features/document-notifications";
import {
  shouldRequestWikiLint,
  WIKI_UP_TO_DATE_NOTICE
} from "@/features/document-notifications/model/wikiLintStatus";
import { railItems, type RailView } from "@/widgets/rail-navigation/ui/RailNavigation";
import { UploadErrorModal } from "@/features/document-upload/ui/UploadErrorModal";
import { DeleteConfirmModal } from "@/shared/ui/DeleteConfirmModal";
import { MergeConfirmModal } from "@/shared/ui/MergeConfirmModal";
import { SourcePreviewPanel } from "@/widgets/source-preview/ui/SourcePreviewPanel";
import { cx } from "@/shared/lib/classNames";
import { useBackdropClick } from "@/shared/lib/useBackdropClick";
import { useBackendData } from "../model/useBackendData";
import { useDocumentUpload } from "@/features/document-upload/model/useDocumentUpload";
import { useProjectTree } from "../model/useProjectTree";
import type { DeletedTreeIds } from "../lib/deletedTreeIds";
import { getSelectionLocation, useTreeSelection, type TreeSelectionState } from "../model/useTreeSelection";
import {
  buildWorkspaceHref,
  formatWorkspaceDocumentTitle,
  getWorkspaceLocationKey,
  getWorkspaceLocationView,
  isDocumentLocation,
  parseWorkspaceLocation,
  toDocumentLocation,
  WORKSPACE_HOME_LOCATION,
  type WorkspaceLocation
} from "../lib/workspaceLocation";
import { useTreeOpenState } from "../model/useTreeOpenState";
import { findContextFolderId } from "../lib/treeOpenState";
import { buildGraphFromBackend, makeRawId, rawNodeIdToDocumentId } from "@/entities/graph/lib/graph";
import { buildDocumentPathSuffixes } from "@/entities/graph/lib/documentLabels";
import { filterGraphProjects, isGraphIngestEligible, selectGraphDocuments } from "@/features/wiki-ingest/model/graphDocuments";
import { selectGraphIngestProgressInputs } from "@/features/wiki-ingest/model/graphIngestProgressInputs";
import { usePdfWikiIngest } from "@/features/wiki-ingest/model/usePdfWikiIngest";
import { getChatEvidenceNotice } from "@/features/wiki-ingest/model/wikiReflectState";
import { PdfIngestConfirmModal } from "@/features/wiki-ingest/ui/PdfIngestConfirmModal";
import { isMarkdownDocument, isPdfDocument } from "@/entities/document/lib/documentKind";
import { isDocumentReadOnly } from "@/entities/document/lib/documentAccess";
import { reflectDocumentToWiki, subscribeConvertStarted, uploadDocumentFile } from "@/entities/document";
import { getDocumentConversionView } from "@/entities/document/lib/documentConversion";
import { getErrorMessage } from "@/shared/lib/errors";
import { buildGeneratedMarkdownFilename } from "@/features/agent-chat/lib/markdownAgent";
import type { GeneratedMarkdownDraft } from "@/features/agent-chat/lib/markdownAgent";
import type { ActiveMarkdownEditContext } from "@/features/agent-chat/lib/markdownEditContext";
import { createClientId, findTreeItem } from "@/entities/tree";
import { getMarkdownDocumentTitle } from "@/entities/document/lib/note";
import { findFirstSelectableNote, findParentLabel, findTreeItemInProjects } from "../lib/treeLookup";
import { useOperationLogFeed } from "../model/useOperationLogFeed";
import { useResizeHandle } from "../model/useResizeHandle";
import { useSidebarLayout } from "../model/useSidebarLayout";
import { useAgentPanelLayout } from "../model/useAgentPanelLayout";
import { useCompactLayout } from "../model/useCompactLayout";
import { AGENT_PANEL_LIMITS, SIDEBAR_BASE_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_RAIL_WIDTH } from "../lib/panelResize";
import { canShowAgentPanel, isAgentPanelVisible } from "../lib/workspaceLayout";
import type { DocumentItemResponse, SourceBlockHighlight } from "@/entities/document";
import type { TreeItem } from "@/entities/tree";
import type { SelectableTreeItem } from "@/widgets/document-sidebar/model/types";
import type { GraphNode } from "@/entities/wiki";
import type { ChatWikiExportResponse } from "@/features/wiki-export";
import styles from "./HomeWorkspace.module.css";

const SOURCE_PREVIEW_DEFAULT_WIDTH = 400;
const SOURCE_PREVIEW_MIN_WIDTH = 300;
const SOURCE_PREVIEW_MAX_FLOOR = 360;
const RESIZE_SAFETY_MARGIN = 120;

export function HomeWorkspace() {
  const [isHomeAgentPanelOpen, setIsHomeAgentPanelOpen] = useState(true);
  const [isGraphAgentPanelOpen, setIsGraphAgentPanelOpen] = useState(false);
  // 화면 상태는 URL(/home?doc=… · ?page=… · ?view=graph 등)에서 파생한다. 쿼리만 바뀌므로 이 컴포넌트는 리마운트되지 않는다.
  const router = useRouter();
  const searchParams = useSearchParams();
  const location = useMemo(() => parseWorkspaceLocation(searchParams), [searchParams]);
  const locationKey = getWorkspaceLocationKey(location);
  const activeView = getWorkspaceLocationView(location);
  const navigate = useCallback((target: WorkspaceLocation, mode: "push" | "replace" = "push") => {
    const href = buildWorkspaceHref(target);
    if (mode === "replace") router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }, [router]);
  // 접근 코드 미입력 상태면 설정 화면에 고정한다. API는 middleware가 403으로 막는다.
  const { isLocked: isAccessLocked } = useAccessGate();
  useEffect(() => {
    if (isAccessLocked && activeView !== "settings") navigate({ kind: "view", view: "settings" }, "replace");
  }, [isAccessLocked, activeView, navigate]);
  const [markdownEditContext, setMarkdownEditContext] = useState<ActiveMarkdownEditContext | null>(null);
  const [pendingExportDocumentId, setPendingExportDocumentId] = useState<string | null>(null);
  const [pendingConvertDocumentIds, setPendingConvertDocumentIds] = useState<readonly string[]>([]);
  const [wikiActionPending, setWikiActionPending] = useState<"ingest" | "lint" | null>(null);
  // 진행 중인 편입 요청의 대상 문서. 채팅 안내 버튼이 "이 노트"가 편입 중인지 구분하는 데 쓴다.
  const [ingestTargetIds, setIngestTargetIds] = useState<readonly string[]>([]);
  const [pdfIngestConfirmation, setPdfIngestConfirmation] = useState<DocumentItemResponse[] | null>(null);
  const graphIngestRunningRef = useRef(false);
  const operationLogFeed = useOperationLogFeed(activeView === "logs");
  // 알림 목록·읽음 상태. 알림 화면 탭의 안 읽음 표시에 쓴다.
  const notificationFeed = useNotificationFeed(activeView === "notifications");
  // 스킬 "실행": 사이드바에서 대상 문서를 고르는 중인 스킬과 고른 트리 항목 (Figma 1527:15924)
  const [skillRun, setSkillRun] = useState<{ skill: SkillResponse; targetItemId: string | null; errorMessage: string | null } | null>(null);
  // 채팅 입력창에 채울 스킬 커맨드. 패널이 열린 뒤 한 번 채운다.
  const [agentComposerDraft, setAgentComposerDraft] = useState<{ id: number; text: string } | null>(null);
  const sidebarLayout = useSidebarLayout();
  // 좁은 화면이면 겹쳐 여는 채팅 패널 폭(넓은 화면이면 null). 좁은 화면에서는 두 패널이 콘텐츠를 밀지 않고 위에 겹친다.
  const compactAgentPanelWidth = useCompactLayout();
  const isCompactLayout = compactAgentPanelWidth !== null;
  // 좁은 화면에서 겹쳐 연 사이드바. 넓은 화면의 접힘 상태(저장 값)는 건드리지 않고, 다른 화면·문서로 이동하면 닫는다.
  const [isCompactSidebarOpen, setIsCompactSidebarOpen] = useState(false);
  const isSidebarCollapsed = isCompactLayout ? !isCompactSidebarOpen : sidebarLayout.isCollapsed;
  useEffect(() => {
    setIsCompactSidebarOpen(false);
  }, [locationKey, isCompactLayout]);
  // 좁은 화면이 되면 채팅 패널이 문서를 덮지 않게 닫아 둔다. 런처 버튼으로 다시 연다.
  useEffect(() => {
    if (!isCompactLayout) return;
    setIsHomeAgentPanelOpen(false);
    setIsGraphAgentPanelOpen(false);
  }, [isCompactLayout]);
  // 콘텐츠 왼쪽 여백. 좁은 화면에서는 레일만 피한다.
  const contentLeft = isCompactLayout ? SIDEBAR_RAIL_WIDTH : sidebarLayout.visibleWidth;
  const sourcePreviewResize = useResizeHandle(
    SOURCE_PREVIEW_DEFAULT_WIDTH,
    SOURCE_PREVIEW_MIN_WIDTH,
    () => Math.max(
      SOURCE_PREVIEW_MAX_FLOOR,
      window.innerWidth - contentLeft - contentRight - RESIZE_SAFETY_MARGIN
    )
  );
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
  // 패널이 실제로 화면에 있는지. 렌더 조건·그래프 우측 여백·알림 위치가 모두 이 값을 기준으로 한다.
  const isAgentPanelShown = isAgentPanelVisible(
    activeView,
    isGraphView ? isGraphAgentPanelOpen : isHomeAgentPanelOpen
  );
  const agentPanelLayout = useAgentPanelLayout({
    isShown: isAgentPanelShown,
    sidebarWidth: sidebarLayout.visibleWidth,
    onCollapse: closeAgentPanel
  });
  // 콘텐츠 오른쪽 여백과 채팅 패널 자체 폭. 좁은 화면에서는 패널이 콘텐츠 위에 겹치므로 콘텐츠는 오른쪽 끝까지 쓴다.
  const contentRight = isCompactLayout ? 0 : agentPanelLayout.visibleWidth;
  const agentPanelSelfWidth = isAgentPanelShown && isCompactLayout ? compactAgentPanelWidth : agentPanelLayout.visibleWidth;
  const hasSourcePreview = Boolean(selection.selectedDocumentTitle);
  // 홈에서 문서가 메인 영역을 채우는 상태(Obsidian식 최근 문서 열람)
  const isDocumentMain = isHomeView && hasSourcePreview;

  useEffect(() => {
    if (!pendingExportDocumentId) return;
    const exportedDocument = documents.find((document) => document.id === pendingExportDocumentId);
    if (!exportedDocument) return;
    const exportedTreeItem = findTreeItemInProjects(projectTree.projects, pendingExportDocumentId);
    if (!exportedTreeItem) return;
    setPendingExportDocumentId(null);
    openDocument(selection.selectTreeGraphNode(exportedTreeItem));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openDocument는 선택 상태 setter와 라우터만 쓴다
  }, [documents, pendingExportDocumentId, projectTree.projects, selection]);

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
      const convertedTreeItem = findTreeItemInProjects(projectTree.projects, pendingDocumentId);
      if (!convertedTreeItem) continue;
      setPendingConvertDocumentIds((ids) => ids.filter((id) => id !== pendingDocumentId));
      openDocument(selection.selectTreeGraphNode(convertedTreeItem));
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openDocument는 선택 상태 setter와 라우터만 쓴다
  }, [documents, pendingConvertDocumentIds, projectTree.projects, selection]);

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

  // 사이드바 "문서" 전환이 돌아갈 마지막 문서 위치. 메모리에만 둔다(새로고침하면 첫 노트).
  const lastDocumentLocationRef = useRef<WorkspaceLocation | null>(null);
  useEffect(() => {
    if (isDocumentLocation(location)) lastDocumentLocationRef.current = location;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 위치 키가 같으면 같은 대상이다
  }, [locationKey]);

  /** 선택한 대상의 문서 URL로 이동한다(뒤로가기로 돌아올 수 있게 push). 이미 그 URL이면 그대로 둔다. */
  function openDocument(opened: TreeSelectionState | null) {
    const target = opened && getSelectionLocation(opened);
    if (!target || getWorkspaceLocationKey(target) === locationKey) return;
    navigate(target);
  }

  // 사이드바·채팅에서 고른 대상: 그래프 화면에서는 그래프 포커스만 옮기고(기존 동작), 그 외에는 문서 화면에서 연다.
  function openSelectedPreview(opened: TreeSelectionState | null) {
    if (isGraphView) return;
    openDocument(opened);
  }

  // 사이드바 문서 행 가운데 클릭: 그 문서 URL을 새 브라우저 탭으로 연다. 이 탭의 선택 상태는 바꾸지 않는다.
  function openTreeItemInNewTab(item: SelectableTreeItem) {
    const nodeId = item.graphNodeId ?? (item.documentId ? makeRawId(item.documentId) : null);
    if (!nodeId) return;
    const target = toDocumentLocation({
      pageId: null,
      documentId: rawNodeIdToDocumentId(nodeId) ?? item.documentId ?? null,
      treeItemId: item.id
    });
    if (target) window.open(buildWorkspaceHref(target), "_blank", "noopener");
  }

  // 열린 문서나 그 상위 폴더가 삭제되면 문서 화면은 /home(첫 노트)으로 바꾸고, 그래프 화면은 선택(포커스)만 지운다.
  function handleTreeDeleted({ documentIds, treeItemIds }: DeletedTreeIds) {
    const isDeleted = (target: WorkspaceLocation | null) =>
      (target?.kind === "document" && documentIds.includes(target.documentId))
      || (target?.kind === "tree" && treeItemIds.includes(target.treeItemId));
    if (isDeleted(lastDocumentLocationRef.current)) lastDocumentLocationRef.current = null;
    const { selectedDocumentId, selectedTreeItemId } = selection;
    const isSelectionDeleted = (selectedDocumentId !== null && documentIds.includes(selectedDocumentId))
      || (selectedTreeItemId !== null && treeItemIds.includes(selectedTreeItemId));
    if (isSelectionDeleted) selection.clearTreeGraphSelection();
    if (isHomeView && (isSelectionDeleted || isDeleted(location))) {
      staleDocumentsAtRef.current = documentsUpdatedAt;
      navigate(WORKSPACE_HOME_LOCATION, "replace");
    }
  }

  // 문서 ↔ 그래프·로그·규칙 전환. "문서"는 마지막으로 본 문서 URL(없으면 /home → 첫 노트)로 돌아간다.
  function handleViewChange(view: RailView) {
    const target: WorkspaceLocation = view === "home"
      ? lastDocumentLocationRef.current ?? WORKSPACE_HOME_LOCATION
      : { kind: "view", view };
    if (getWorkspaceLocationKey(target) === locationKey) return;
    navigate(target);
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

  // 브라우저 탭 제목: "문서 제목 - Fruition Agent" / "그래프 - Fruition Agent". 떠날 때 기본 제목으로 되돌린다.
  // 클라이언트 이동이 끝나면 Next가 metadata 제목을 다시 적용하므로, URL이 바뀔 때도 다음 프레임에 덮어쓴다.
  useEffect(() => {
    const title = formatWorkspaceDocumentTitle(screenTitle);
    document.title = title;
    const frameId = requestAnimationFrame(() => {
      document.title = title;
    });
    return () => {
      cancelAnimationFrame(frameId);
      document.title = formatWorkspaceDocumentTitle(null);
    };
  }, [screenTitle, locationKey]);

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

  async function createGeneratedMarkdownDocument(draft: GeneratedMarkdownDraft) {
    const noteId = createClientId("ai-note");
    const body = draft.markdown.endsWith("\n") ? draft.markdown : `${draft.markdown}\n`;
    const file = new File(
      [`<!-- fruition-note: ${noteId} -->\n${body}`],
      buildGeneratedMarkdownFilename(draft.title),
      { type: "text/markdown" }
    );
    const created = await uploadDocumentFile(file).catch(async (error: unknown) => {
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

  async function handleChatDocumentExported(response: ChatWikiExportResponse) {
    setPendingExportDocumentId(response.exportDocumentId);
    await refreshBackendData({ throwOnError: true });
  }

  // --- 그래프 사이드바 위키 액션 ---
  async function handleGraphIngest(targets: DocumentItemResponse[]) {
    if (graphIngestRunningRef.current || wikiActionPending || targets.length === 0) return;
    graphIngestRunningRef.current = true;
    setWikiActionPending("ingest");
    setIngestTargetIds(targets.map((target) => target.id));
    try {
      await sendGraphIngestRequests(targets);
    } finally {
      // 알림·재조회 단계에서 예외가 나도 버튼이 "위키 편입 중…"에 머물지 않게 한다.
      setWikiActionPending(null);
      setIngestTargetIds([]);
      graphIngestRunningRef.current = false;
    }
  }

  async function sendGraphIngestRequests(targets: DocumentItemResponse[]) {
    // 한 문서가 실패해도 나머지 문서의 요청은 계속 보낸다.
    const results = await Promise.allSettled(
      targets.map((target) => isPdfDocument(target)
        ? pdfWikiIngest.startPdfIngest(target)
        : reflectDocumentToWiki(target.id, target.document_role))
    );
    // 실패 사유는 백엔드 원문을 그대로 보여준다. 개수만 알려주면 원인을 알 수 없다.
    const failures = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [`${targets[index].filename}: ${getErrorMessage(result.reason, "요청에 실패했습니다.")}`]
        : []
    );
    const startedCount = targets.length - failures.length;

    if (startedCount > 0) {
      await refreshBackendData().catch(() => {});
      publishNotice({
        kind: "completed",
        title: "위키 편입 요청",
        message: `${startedCount}개 문서 처리를 시작했습니다.`
      });
    }
    if (failures.length > 0) {
      publishNotice({
        kind: "failed",
        title: "위키 편입 실패",
        message: failures.join(" / ")
      });
    }
  }

  // 변환 전 PDF가 섞여 있으면 먼저 Markdown으로 변환한다는 확인을 받는다.
  function requestGraphIngest(targets: DocumentItemResponse[]) {
    if (targets.some(isPdfDocument)) {
      setPdfIngestConfirmation(targets);
      return;
    }
    void handleGraphIngest(targets);
  }

  async function handleGraphLint() {
    if (wikiActionPending) return;
    setWikiActionPending("lint");
    try {
      // 마지막 다듬기 이후 위키 변경이 있을 때만 실제 lint를 보낸다.
      const { needs_lint } = await fetchWikiMaintenanceStatus();
      if (!shouldRequestWikiLint(needs_lint)) {
        publishNotice({ kind: "info", ...WIKI_UP_TO_DATE_NOTICE });
        return;
      }
      const { changedPageCount, operationId } = await requestWikiLint(false);
      void refreshBackendData();
      publishNotice({
        operation: { type: "lint", id: operationId },
        kind: "completed",
        title: "Lint 완료",
        message: `${changedPageCount}개 페이지를 다듬었습니다.`
      });
    } catch (error: unknown) {
      publishNotice({
        kind: "failed",
        title: "Lint 실패",
        message: getErrorMessage(error, "Lint 요청에 실패했습니다.")
      });
    } finally {
      setWikiActionPending(null);
    }
  }

  function handleResizePointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (sidebarLayout.update(event)) return;
    if (agentPanelLayout.update(event)) return;
    sourcePreviewResize.update(event);
  }

  function handleResizePointerEnd(event: ReactPointerEvent<HTMLElement>) {
    if (sidebarLayout.stop(event)) return;
    if (agentPanelLayout.stop(event)) return;
    sourcePreviewResize.stop(event);
  }

  // 스킬 화면을 벗어나면(레일·검색 결과 이동 등) 대상 고르기를 끝낸다.
  useEffect(() => {
    if (activeView !== "skills") setSkillRun(null);
  }, [activeView]);

  function startSkillRun(skill: SkillResponse) {
    // 대상은 사이드바 문서 패널에서 고르므로 접혀 있으면 편다.
    expandSidebar();
    setSkillRun({ skill, targetItemId: null, errorMessage: null });
  }

  /** 스킬은 문서 하나에만 실행한다(agent turn이 요청마다 문서 하나만 받는다). 다른 문서를 누르면 바꿔 고른다. */
  function pickSkillTarget(itemId: string) {
    setSkillRun((current) => current && {
      ...current,
      targetItemId: current.targetItemId === itemId ? null : itemId,
      errorMessage: null
    });
  }

  /** 고른 문서를 열고 채팅 패널 입력창에 "/slug "를 채운다. 실행은 사용자가 할 일을 적어 보낼 때 에이전트가 한다. */
  function confirmSkillRun() {
    const targetItemId = skillRun?.targetItemId;
    if (!skillRun || !targetItemId) return;
    const item = projectTree.projects.map((project) => findTreeItem(project.items, targetItemId)).find(Boolean);
    const targetDocument = item?.documentId ? documents.find((document) => document.id === item.documentId) : undefined;
    // 에이전트는 Markdown 문서에서만 스킬을 실행한다(백엔드 agent turn 제약).
    if (!item || !targetDocument || !isMarkdownDocument(targetDocument)) {
      setSkillRun({ ...skillRun, errorMessage: "Markdown 문서만 스킬을 실행할 수 있습니다. 다른 문서를 골라 주세요." });
      return;
    }
    setSkillRun(null);
    setIsHomeAgentPanelOpen(true);
    setAgentComposerDraft({ id: Date.now(), text: `/${skillRun.skill.slug} ` });
    openDocument(selection.selectTreeGraphNode(item));
  }

  function expandSidebar() {
    if (isCompactLayout) setIsCompactSidebarOpen(true);
    else if (sidebarLayout.isCollapsed) sidebarLayout.expand();
  }

  function collapseSidebar() {
    if (isCompactLayout) setIsCompactSidebarOpen(false);
    else sidebarLayout.collapse();
  }

  /** 현재 뷰(홈/그래프)의 채팅 패널을 닫는다. 헤더 숨기기 버튼과 폭 조절 핸들 접기가 함께 쓴다. */
  function closeAgentPanel() {
    if (isGraphView) setIsGraphAgentPanelOpen(false);
    else setIsHomeAgentPanelOpen(false);
  }

  // main 배경을 직접 누르고 뗐을 때만 선택 해제. 자식(사이드바 여백·폴더 헤더 등)에서 버블된 클릭이나
  // 편집기에서 드래그해 바깥에서 놓은 클릭까지 해제하면 노트 선택이 풀려 편집기가 비어 보인다.
  // 문서 화면은 URL이 열린 대상을 정하므로 배경 클릭으로 닫지 않는다.
  const workspaceBackgroundClick = useBackdropClick<HTMLElement>(() => {
    if (isGraphView) selection.clearTreeGraphSelection();
  });

  return (
    <main
      className={cx(
        "workspace",
        isSidebarCollapsed && "is-sidebar-collapsed",
        isCompactLayout && "is-compact-layout",
        hasSourcePreview && "has-source-preview",
        isDocumentMain && "is-document-main",
        (sidebarLayout.isDragging || agentPanelLayout.isDragging) && "is-panel-resizing"
      )}
      style={{
        "--sidebar-width": `${contentLeft}px`,
        "--sidebar-self-width": `${isCompactLayout ? (isCompactSidebarOpen ? SIDEBAR_BASE_WIDTH : SIDEBAR_RAIL_WIDTH) : sidebarLayout.visibleWidth}px`,
        "--agent-panel-width": `${contentRight}px`,
        "--agent-panel-self-width": `${agentPanelSelfWidth}px`,
        "--source-preview-width": `${sourcePreviewResize.width}px`
      } as CSSProperties}
      {...workspaceBackgroundClick}
      onPointerMove={handleResizePointerMove}
      onPointerUp={handleResizePointerEnd}
      onPointerCancel={handleResizePointerEnd}
    >
      <DocumentSidebar
        projects={isGraphView ? graphProjects : projectTree.projects}
        draggedItemId={projectTree.draggedItem?.itemId ?? null}
        selectedItemId={selection.selectedTreeItemId}
        selectedItemIds={skillRun ? new Set(skillRun.targetItemId ? [skillRun.targetItemId] : []) : projectTree.selectedItemIds}
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
          onLint: () => void handleGraphLint()
        }}
        onViewChange={handleViewChange}
        isCollapsed={isSidebarCollapsed}
        isOverlay={isCompactLayout}
        onCollapseSidebar={collapseSidebar}
        onExpandSidebar={expandSidebar}
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
        onToggleSelectItem={skillRun ? pickSkillTarget : projectTree.toggleSelectedItem}
        onClearSelectedItems={projectTree.clearSelectedItems}
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

      {/* 좁은 화면에서 겹쳐 연 사이드바 바깥을 누르면 닫는다. 스킬 대상을 고르는 동안에는 안내의 확인 버튼을 가리지 않게 두지 않는다. */}
      {isCompactLayout && isCompactSidebarOpen && !skillRun && (
        <button type="button" tabIndex={-1} className="compact-sidebar-backdrop" aria-label="사이드바 닫기" onClick={collapseSidebar} />
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
            width={sourcePreviewResize.width}
            onResizeStart={sourcePreviewResize.start}
            onMarkdownEditContextChange={setMarkdownEditContext}
            onRenameDocument={projectTree.renameDocumentById}
            onRefreshDocuments={() => void refreshBackendData()}
            documentStatus={selectedDocumentStatus}
            readOnly={isSelectedDocumentReadOnly}
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

      {pdfIngestConfirmation && (
        <PdfIngestConfirmModal
          pdfCount={pdfIngestConfirmation.filter(isPdfDocument).length}
          onCancel={() => setPdfIngestConfirmation(null)}
          onConfirm={() => {
            const selectedIds = new Set(pdfIngestConfirmation.map((document) => document.id));
            // 확인을 기다리는 동안 상태가 바뀐 문서(변환 시작·편입 진행 등)에는 중복 요청을 보내지 않는다.
            const targets = documents.filter((document) =>
              selectedIds.has(document.id) && isGraphIngestEligible(document, documents)
            );
            setPdfIngestConfirmation(null);
            void handleGraphIngest(targets);
          }}
        />
      )}

      {/* 채팅 패널이 닫혀 있으면 우하단 원형 버튼으로 연다 (Figma 1426:15877 / 1406:14202). */}
      {!isAgentPanelShown && canShowAgentPanel(activeView) && (
        <AgentLauncher
          onOpen={() => (isGraphView ? setIsGraphAgentPanelOpen(true) : setIsHomeAgentPanelOpen(true))}
        />
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
      {(isGraphView ? isGraphAgentPanelOpen : isHomeAgentPanelOpen) && (
        <div className={cx("agent-panel-host", !isAgentPanelShown && "is-hidden")}>
        <AgentPanel
          onClose={closeAgentPanel}
          onOpenSourceBlocks={(documentId, title, highlights) => openSelectedPreview(openSourceBlocks(documentId, title, highlights))}
          onCreateMarkdownDocument={createGeneratedMarkdownDocument}
          markdownEditContext={markdownEditContext}
          onDocumentExported={handleChatDocumentExported}
          nodes={graphData.nodes}
          composerDraft={agentComposerDraft}
          wikiEvidenceNotice={chatContextDocument && chatEvidenceNotice ? {
            ...chatEvidenceNotice,
            // handleGraphIngest는 다른 위키 작업이 진행 중이면 요청을 무시하므로 그동안 버튼을 막는다.
            isDisabled: wikiActionPending !== null || pdfWikiIngest.isPending,
            isIngesting: wikiActionPending === "ingest" && ingestTargetIds.includes(chatContextDocument.id),
            onIngest: () => requestGraphIngest([chatContextDocument])
          } : null}
        />
        </div>
      )}

      {!isHomeView && !isGraphView && (
        activeView === "skills" ? (
          <SkillsView onRunSkill={startSkillRun} />
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
        ) : activeView === "settings" ? (
          <SettingsPanel />
        ) : (
          <section className="blank-view" aria-label={`${railItems.find((item) => item.id === activeView)?.label ?? ""} 빈 화면`} />
        )
      )}

      {activeView === "skills" && skillRun && (
        <SkillRunCoach
          hasTarget={skillRun.targetItemId !== null}
          errorMessage={skillRun.errorMessage}
          onCancel={() => setSkillRun(null)}
          onNext={confirmSkillRun}
        />
      )}

      <DocumentProcessingNotifications documents={documents} />
      {upload.hasRejectedFiles && <UploadErrorModal onConfirm={upload.clearRejectedFiles} />}
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
