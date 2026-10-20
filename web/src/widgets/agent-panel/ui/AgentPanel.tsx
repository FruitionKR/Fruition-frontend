"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import contextChipCloseIcon from "@/shared/assets/svg/agent/context-chip-close.svg";
import contextChipClosePrimaryIcon from "@/shared/assets/svg/agent/context-chip-close-primary.svg";
import { AgentBody } from "@/features/agent-chat/ui/AgentBody";
import { AgentComposer } from "@/features/agent-chat/ui/AgentComposer";
import { AGENT_PANEL_VIEW_IDS, AgentHeader, type AgentPanelView } from "@/features/agent-chat/ui/AgentHeader";
import { isCapturingPhase, MeetingListView, MeetingNotesView, RecordingFileInput, useMeetingSession } from "@/features/meeting-dictation";
import { MarkdownCreatePreview } from "@/features/agent-chat/ui/MarkdownCreatePreview";
import { MarkdownEditPreview } from "@/features/agent-chat/ui/MarkdownEditPreview";
import { AgentTaskBody } from "@/features/agent-chat/ui/AgentTaskBody";
import { AGENT_TURN_SLOW_MESSAGE } from "@/features/agent-chat/lib/turnFollow";
import { ProposalDecisionButtons, type InlineEditReviewState } from "@/features/agent-chat/ui/InlineEditReview";
import { countPendingProposals, countProposals, headingAtLine, proposalSourceLabel } from "@/features/agent-chat/lib/inlineEditReview";
import type { FolderOrganizeRequest } from "@/features/agent-chat/lib/folderOrganize";
import { AgentAssetIcon } from "@/features/agent-chat/ui/AgentIcons";
import { SKILL_PICKER_LIST_ID, SkillSlashPicker, skillPickerOptionId } from "@/features/agent-chat/ui/SkillSlashPicker";
import { resolveSubmitRoute, selectionChipLabel, skillSheetPanelView, splitChatAndTaskMessages } from "@/features/agent-chat/lib/taskThread";
import { useChatThread } from "@/features/agent-chat/model/useChatThread";
import { fetchCurrentChatSessionId } from "@/entities/chat";
import { publishNotice } from "@/features/document-notifications";
import { exportChatWiki, getChatExportSuccessMessage, type ChatWikiExportResponse } from "@/features/wiki-export";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import type { GeneratedMarkdownDraft } from "@/features/agent-chat/lib/agentTurn";
import { fetchChatSessions } from "@/entities/chat/api/chat";
import type { ActiveMarkdownEditContext } from "@/features/agent-chat/lib/markdownEditContext";
import {
  classifyChatExportPairs,
  EMPTY_CHAT_PAIR_RANGE_SELECTION,
  selectChatPairRange,
  toggleChatPair,
  type ChatPairRangeSelection,
  type ChatPairSelectionKind
} from "@/features/agent-chat/lib/chatPairSelection";
import type { SourceBlockHighlight } from "@/entities/document";
import type { MeetingListItem } from "@/entities/meeting";
import type { GraphNode } from "@/entities/wiki";
import { useAgentTurn } from "../model/useAgentTurn";
import { useAiModelSelection } from "../model/useAiModelSelection";
import { useSkillSlashPicker } from "../model/useSkillSlashPicker";
import { composerSkillIntent, isOpenDocumentOptIn, shouldSendOpenDocument } from "../lib/openDocumentSource";
import styles from "@/features/agent-chat/ui/AgentChat.module.css";

const PAIR_SELECTION_KIND_OPTIONS: { kind: ChatPairSelectionKind; label: string }[] = [
  { kind: "range", label: "범위 선택" },
  { kind: "individual", label: "개별 선택" }
];

export function AgentPanel({
  onClose,
  onOpenSourceBlocks,
  onCreateMarkdownDocument,
  markdownEditContext,
  onDocumentExported,
  onIngestExportedDocument,
  nodes,
  skillRun = null,
  onSkillRunSent,
  wikiEvidenceNotice,
  onMeetingNotesSaved,
  onMeetingActiveChange,
  onManageSkills,
  onSaveRequestAsSkill,
  onOpenFolderOrganize,
  skillTestRunSlotRef,
  openDocumentTitle = null,
  onEditReviewChange,
  isShown = true
}: {
  onClose: () => void;
  onOpenSourceBlocks: (documentId: string, title: string, highlights: SourceBlockHighlight[]) => void;
  onCreateMarkdownDocument: (draft: GeneratedMarkdownDraft, folderId: string | null) => Promise<void>;
  markdownEditContext?: ActiveMarkdownEditContext | null;
  onDocumentExported?: (response: ChatWikiExportResponse) => Promise<void> | void;
  /** 채팅 편입으로 저장한 문서의 위키 편입을 시작한다. 편입 권한이 없거나 확인 중이면 없어 알림에 버튼을 두지 않는다. */
  onIngestExportedDocument?: (documentId: string) => void;
  nodes?: GraphNode[];
  /**
   * 스킬 화면에서 대상을 고른 스킬 실행(Figma 1567:25081 '다음'). 작업 탭 요청으로 한 번 보낸다.
   * documentId가 있으면 그 문서가 열려 편집 문맥이 준비된 뒤 문서와 함께 보내고, 없으면(폴더 대상) 문서 없이
   * folderId를 작업 대상 폴더(folder_id)로 실어 보낸다.
   */
  skillRun?: {
    id: number;
    message: string;
    documentId: string | null;
    folderId: string | null;
    /** 문서 대상이면 그 문서가 있는 폴더(루트면 null). 되묻기에 '새 문서로 만들기'로 답하면 새 문서를 그 옆에 둔다. */
    documentFolderId?: string | null;
  } | null;
  /** skillRun을 보냈다. 같은 실행을 다시 보내지 않도록 비운다. */
  onSkillRunSent?: (id: number) => void;
  /** 열린 노트가 위키 미편입·편입 후 수정 상태일 때 composer 위에 띄우는 안내. */
  wikiEvidenceNotice?: {
    message: string;
    actionLabel: string | null;
    isDisabled: boolean;
    /** 막힌 사유(편입 권한 없음 등). 버튼 툴팁으로 보여 준다. */
    disabledReason?: string | null;
    isIngesting: boolean;
    onIngest: () => void;
  } | null;
  /** 회의록을 문서로 저장했다(#148). 문서 목록을 새로 받고 그 문서를 연다. */
  onMeetingNotesSaved?: (documentId: string) => Promise<void> | void;
  /** 회의 화면이 열려 있는지(#148). 열려 있는 동안 화면은 패널을 닫아도 마운트해 두어 회의·회의록을 잃지 않는다. */
  onMeetingActiveChange?: (isActive: boolean) => void;
  /** 스킬 고르기의 "스킬 관리 >"(Figma 1627:9913). 스킬 화면으로 옮긴다. */
  onManageSkills?: () => void;
  /** 작업 카드의 "이 요청을 스킬로 저장"(Figma 1671:13245). 원래 요청 문장을 넘긴다. */
  onSaveRequestAsSkill?: (request: string) => void;
  /** 폴더 정리 계획을 메인 영역의 미리보기 탭으로 연다(Figma 1656:11542). */
  onOpenFolderOrganize?: (request: FolderOrganizeRequest) => void;
  /** 스킬 만들기·상세 시트가 열린 동안 입력창 위에 "테스트 실행" 자리를 둔다(Figma 1671:14585). 시트가 이 요소에 그린다. */
  skillTestRunSlotRef?: (element: HTMLDivElement | null) => void;
  /** 열린 문서 이름. 본문에 붙인 편집 제안 카드의 보조 설명에 쓴다(Figma 1610:9145). */
  openDocumentTitle?: string | null;
  /** 열린 문서 본문에 붙여 보여 줄 편집 제안(Figma 1571:27625). 없어지면 null. */
  onEditReviewChange?: (review: InlineEditReviewState | null) => void;
  /** 패널이 화면에 보이는지. 패널 없는 화면에서는 마운트된 채 숨겨진다. */
  isShown?: boolean;
}) {
  const [activeView, setActiveView] = useState<AgentPanelView>("chat");
  // 회의록은 열린 Markdown 문서가 있으면 그 문서 끝에 추가할 수 있다(회의를 시작할 때의 문서로 고정된다).
  const panelRef = useRef<HTMLElement | null>(null);
  const recordingInputRef = useRef<HTMLInputElement | null>(null);
  const pickRecording = useCallback(() => recordingInputRef.current?.click(), []);
  const handleMeetingDeleted = useCallback(() => {
    publishNotice({ kind: "completed", title: "회의 삭제", message: "회의를 삭제했습니다. 문서로 저장한 회의록은 남아 있어요." });
    // 회의 화면이 사라져 포커스가 body로 떨어지지 않게 입력창으로 옮긴다.
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus());
  }, []);
  const meeting = useMeetingSession({
    documentId: markdownEditContext?.documentId ?? null,
    onDocumentSaved: onMeetingNotesSaved,
    onMeetingDeleted: handleMeetingDeleted
  });
  const isMeetingViewOpen = meeting.phase !== "idle";
  // 지난 회의 목록(진행 중인 회의 이어 보기). 목록에서 연 회의 화면을 닫으면 목록으로 돌아온다.
  const [isMeetingListOpen, setIsMeetingListOpen] = useState(false);
  const [meetingOpenError, setMeetingOpenError] = useState<string | null>(null);
  const resumeMeeting = meeting.resume;
  const openMeetingFromList = useCallback((item: MeetingListItem) => {
    setMeetingOpenError(null);
    void resumeMeeting(item).then(setMeetingOpenError);
  }, [resumeMeeting]);
  const isMeetingAreaOpen = isMeetingViewOpen || isMeetingListOpen;
  useEffect(() => {
    onMeetingActiveChange?.(isMeetingViewOpen);
  }, [isMeetingViewOpen, onMeetingActiveChange]);
  // 패널이 화면에서 사라지면(숨기기·패널 없는 화면) 보이지 않는 채 마이크·과금이 이어지지 않도록 받아쓰기를 정상 종료한다.
  // 남은 구간을 저장하고 회의록을 이어서 만들므로 패널을 다시 열면 결과가 보인다.
  const isMeetingCapturing = isCapturingPhase(meeting.phase);
  const stopMeeting = meeting.stop;
  useEffect(() => {
    if (!isShown && isMeetingCapturing) stopMeeting();
  }, [isMeetingCapturing, isShown, stopMeeting]);
  const isChatVisible = activeView === "chat" && !isMeetingAreaOpen;
  const [composerValue, setComposerValue] = useState("");
  const restoreComposerQuestion = useCallback((question: string) => {
    setComposerValue((current) => current || question);
  }, []);
  const [isExporting, setIsExporting] = useState(false);
  const [exportErrorMessage, setExportErrorMessage] = useState<string | null>(null);
  const [isPairSelectionMode, setIsPairSelectionMode] = useState(false);
  const [pairSelection, setPairSelection] = useState<ChatPairRangeSelection>(EMPTY_CHAT_PAIR_RANGE_SELECTION);
  const [pairSelectionKind, setPairSelectionKind] = useState<ChatPairSelectionKind>("range");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionTitle, setActiveSessionTitle] = useState<string | null>(null);
  // 마운트 시 현재 활성 세션을 확보해 헤더 강조·메시지 로드의 기준으로 삼는다.
  useEffect(() => {
    fetchCurrentChatSessionId().then(setActiveSessionId).catch(() => undefined);
  }, []);
  const {
    aiModels,
    selectedModel,
    aiModelCatalogStatus,
    aiModelsErrorMessage,
    allowWebSearch,
    handleWebSearchChange,
    handleModelChange
  } = useAiModelSelection();
  const {
    messages,
    queryErrorMessage,
    chatLoadErrorMessage,
    animatedMessageId,
    activeTurn,
    isLoading,
    isCancelling,
    queryStatusMessage,
    queryStages,
    hasPendingMessages,
    refreshMessages,
    submitQuery,
    cancelQuery
  } = useChatThread(activeSessionId);
  const selectedPairIds = pairSelection.selectedPairIds;
  const agentTurn = useAgentTurn({
    markdownEditContext,
    activeSessionId,
    selectedModel,
    selectedPairIds,
    allowWebSearch,
    refreshMessages,
    onCreateMarkdownDocument,
    // 크레딧 부족 거절은 충전 뒤 다시 보낼 수 있게 입력을 되돌린다(#153).
    onInsufficientCredit: restoreComposerQuestion
  });
  const { agentTurnRequest, agentTurnResponse, isAgentTurnLoading, isCreatingMarkdown, editPreviewState, taskRunIds } = agentTurn;
  // 이 화면에서 보낸 폴더 정리 요청의 계획이 도착하면 미리보기 탭을 바로 연다. 지난 기록은 작업 카드의 버튼으로 연다.
  const arrivedFolderOrganizeTurnId = agentTurnResponse?.result.action === "folder_organize" ? agentTurnResponse.requestId : null;
  const arrivedFolderOrganizeQuestion = agentTurnRequest?.message ?? null;
  useEffect(() => {
    if (arrivedFolderOrganizeTurnId) onOpenFolderOrganize?.({ turnId: arrivedFolderOrganizeTurnId, question: arrivedFolderOrganizeQuestion });
    // 도착 시 한 번만 연다. 콜백 identity가 바뀌어도 다시 열지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedFolderOrganizeTurnId]);
  // 채팅 탭은 위키 질의 문답만, 작업 탭은 agent turn(문서 편집·폴더 정리·스킬) 문답만 보여 준다(2026-10-19 계약).
  const { chatMessages, taskItems } = useMemo(() => splitChatAndTaskMessages(messages, taskRunIds), [messages, taskRunIds]);
  const { selectablePairIds: exportPairIds, excludedPairIds } = useMemo(
    () => classifyChatExportPairs(chatMessages),
    [chatMessages]
  );
  const isWorkView = activeView === "work";
  // 스킬 시트가 열린 동안(테스트 실행 자리가 있는 동안) 작업 탭을 보이고, 닫히면 원래 탭으로 돌린다. 대화는 그대로 둔다.
  const isSkillSheetOpen = skillTestRunSlotRef != null;
  const viewBeforeSkillSheetRef = useRef<AgentPanelView | null>(null);
  useEffect(() => {
    const next = skillSheetPanelView(isSkillSheetOpen, activeView, viewBeforeSkillSheetRef.current);
    viewBeforeSkillSheetRef.current = next.saved;
    setActiveView(next.view);
    // 시트가 열리고 닫힐 때만 탭을 바꾼다. 열린 동안 사용자가 고른 탭은 건드리지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSkillSheetOpen]);
  // 작업 대상 칩(Figma 1627:9925). ×로 뺀 문서·선택은 같은 문서·같은 선택인 동안만 빠진다.
  const [excludedDocumentId, setExcludedDocumentId] = useState<string | null>(null);
  const [excludedSelectionKey, setExcludedSelectionKey] = useState<string | null>(null);
  // '새 문서로 만들기' 스킬에서 "현재 문서" 칩을 눌러 원문으로 쓰기로 한 문서. 보내면 비운다.
  const [optedInDocumentId, setOptedInDocumentId] = useState<string | null>(null);
  const openDocumentId = markdownEditContext?.documentId ?? null;
  const skillPicker = useSkillSlashPicker({ value: composerValue, isEnabled: isWorkView && !isMeetingAreaOpen, onChange: setComposerValue });
  const composerIntent = isWorkView ? composerSkillIntent(composerValue, skillPicker.skills) : null;
  const isSourceOptIn = isOpenDocumentOptIn(composerIntent);
  const editorTarget = markdownEditContext?.editorSnapshot.target;
  const selectionKey = openDocumentId && editorTarget?.type === "selection"
    ? `${openDocumentId}:${editorTarget.startLine}-${editorTarget.endLine}`
    : null;
  // "@문서" 고르기 UI는 아직 없어 멘션한 문서는 늘 없다(hasDocumentMention: false).
  const isDocumentIncluded = openDocumentId !== null && shouldSendOpenDocument({
    intent: composerIntent,
    isExcluded: excludedDocumentId === openDocumentId,
    isOptedIn: optedInDocumentId === openDocumentId,
    hasDocumentMention: false
  });
  const isSelectionKept = selectionKey !== null && excludedSelectionKey !== selectionKey;
  const isSelectionIncluded = isDocumentIncluded && isSelectionKept;
  // 열린 문서 문맥. 칩에서 뺀 선택은 문서 전체 대상으로 바꾼다. 문서를 실을지는 따로 정한다.
  const documentContext = useMemo<ActiveMarkdownEditContext | null>(() => {
    if (!markdownEditContext) return null;
    const { editorSnapshot } = markdownEditContext;
    if (editorSnapshot.target.type !== "selection" || isSelectionKept) return markdownEditContext;
    // 선택을 뺐으면 문서 전체를 대상으로 보낸다.
    const lastLine = editorSnapshot.markdown.split("\n").length;
    return { ...markdownEditContext, editorSnapshot: { ...editorSnapshot, target: { type: "whole_document", startLine: 1, endLine: lastLine } } };
  }, [isSelectionKept, markdownEditContext]);
  const taskContext = isDocumentIncluded ? documentContext : null;
  const isSubmitting = isLoading || isAgentTurnLoading || isCreatingMarkdown || hasPendingMessages;
  // 스킬 실행 요청: 세션·모델이 준비되고, 문서 대상이면 그 문서의 편집 문맥이 들어온 뒤 작업 탭으로 보낸다.
  const sentSkillRunId = useRef<number | null>(null);
  // 마지막으로 보낸 스킬 실행의 문서와 그 문서가 있는 폴더. 되묻기에 '새 문서로 만들기'로 답하면 그 폴더를 folder_id로 싣는다.
  const lastSkillRunDocument = useRef<{ documentId: string; folderId: string | null } | null>(null);
  const skillRunContext = skillRun?.documentId && markdownEditContext?.documentId === skillRun.documentId ? markdownEditContext : null;
  const isSkillRunReady = Boolean(skillRun && (!skillRun.documentId || skillRunContext) && activeSessionId && selectedModel && !isSubmitting);
  useEffect(() => {
    if (!skillRun || !isSkillRunReady || !activeSessionId || !selectedModel || sentSkillRunId.current === skillRun.id) return;
    sentSkillRunId.current = skillRun.id;
    lastSkillRunDocument.current = skillRun.documentId ? { documentId: skillRun.documentId, folderId: skillRun.documentFolderId ?? null } : null;
    setActiveView("work");
    // 스킬 시트에서 실행했으면 화면 전환(URL)이 늦게 반영돼 시트가 이 뒤에 닫힐 수 있다. 닫힐 때도 작업 탭에 머물게 한다.
    if (viewBeforeSkillSheetRef.current !== null) viewBeforeSkillSheetRef.current = "work";
    agentTurn.submitAgentTurn(skillRun.message, skillRunContext, activeSessionId, selectedModel, selectedPairIds, skillRun.folderId);
    onSkillRunSent?.(skillRun.id);
    // 준비가 끝난 순간 한 번만 보낸다. 콜백·문맥 identity 변화로 다시 보내지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillRun?.id, isSkillRunReady]);
  const sessionTitle = activeSessionTitle ?? "새 채팅";
  const completedReplies = messages.filter((message) => message.role === "assistant" && message.status === "completed").length;
  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function loadTitle() {
      attempts += 1;
      try {
        const response = await fetchChatSessions();
        if (cancelled) return;
        const title = response.sessions.find((session) => session.id === activeSessionId)?.title ?? null;
        setActiveSessionTitle(title);
        if (completedReplies > 0 && (!title || title === "새 채팅") && attempts < 30) {
          timer = setTimeout(loadTitle, 2000);
        }
      } catch {
        // 제목 조회 실패가 대화 표시를 막지는 않는다.
      }
    }
    void loadTitle();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeSessionId, completedReplies]);
  // 작업 탭 입력(Figma 1610:9628). "@문서"는 아직 고르기 UI가 없고, 열린 문서가 "현재 문서" 칩으로 붙는다.
  const composerPlaceholder = isWorkView ? "이 작업에 추가 요청하기 (/스킬 · @문서)" : "AI 에이전트에게 무엇이든 물어보세요.";

  /**
   * 스킬 되묻기 답(`/slug …`)을 열린 문서 문맥과 함께 보낸다. '새 문서로 만들기'이고 사이드바에서 같은 문서로 실행했던
   * 스킬이면 새 문서를 그 문서 옆에 두도록 문서가 있는 폴더를 folder_id로 싣는다.
   */
  function answerSkillQuestion(request: string, createsDocument: boolean) {
    if (isSubmitting || !activeSessionId || !selectedModel) return;
    const ran = lastSkillRunDocument.current;
    // 되묻기 답은 '상황에 맞게' 스킬이라 입력창의 `/slug`와 상관없이 ×로 빼지 않은 열린 문서를 싣는다.
    const answerContext = excludedDocumentId === openDocumentId ? null : documentContext;
    const folderId = createsDocument && ran && ran.documentId === answerContext?.documentId ? ran.folderId : null;
    agentTurn.submitAgentTurn(request, answerContext, activeSessionId, selectedModel, selectedPairIds, folderId);
  }

  /** 계획 단계에서 실패한 작업(폴더 정리 등)을 같은 요청·대상 폴더로 다시 보낸다. */
  function retryTask(request: string, folderId: string | null) {
    if (isSubmitting || !activeSessionId || !selectedModel) return;
    agentTurn.submitAgentTurn(request, taskContext, activeSessionId, selectedModel, selectedPairIds, folderId);
  }

  function handleSubmit() {
    const question = composerValue.trim();
    const route = resolveSubmitRoute(activeView, question);
    if (!route || isSubmitting) return;
    if (route === "task") {
      // 작업 탭은 항상 agent turn(mode=task)이다. 열린 문서가 없어도 보낸다(폴더 정리·폴더 스킬).
      if (!activeSessionId || !selectedModel) return;
      setComposerValue("");
      setOptedInDocumentId(null);
      agentTurn.submitAgentTurn(question, taskContext, activeSessionId, selectedModel, selectedPairIds);
      return;
    }
    // 채팅 탭은 문서가 열려 있어도 위키 질의(Query)만 보낸다.
    // 질의 경로는 provider/model 쌍이 반드시 필요하다. 카탈로그를 못 받았으면 입력을 지우지 않고 멈춘다.
    if (!selectedModel) return;
    setComposerValue("");
    void submitQuery(question, { provider: selectedModel.provider, model: selectedModel.model }, allowWebSearch).then((insufficientCredit) => {
      // 크레딧 부족 거절은 충전 뒤 다시 보낼 수 있게 입력을 되돌린다(#153).
      if (insufficientCredit) setComposerValue((current) => current || question);
    });
  }

  function startPairSelection() {
    if (isSubmitting || isExporting || exportPairIds.length === 0) return;
    setExportErrorMessage(null);
    setPairSelection(EMPTY_CHAT_PAIR_RANGE_SELECTION);
    setIsPairSelectionMode(true);
  }

  function selectPair(pairId: string) {
    if (isExporting) return;
    const select = pairSelectionKind === "individual" ? toggleChatPair : selectChatPairRange;
    setPairSelection((current) => select(exportPairIds, current, pairId));
  }

  function changePairSelectionKind(kind: ChatPairSelectionKind) {
    if (isExporting || kind === pairSelectionKind) return;
    // 범위 선택과 개별 선택은 선택 규칙이 달라 모드를 바꾸면 선택을 처음부터 다시 한다.
    setPairSelectionKind(kind);
    setPairSelection(EMPTY_CHAT_PAIR_RANGE_SELECTION);
  }

  function cancelPairSelection() {
    setPairSelection(EMPTY_CHAT_PAIR_RANGE_SELECTION);
    setIsPairSelectionMode(false);
  }

  async function acceptExport() {
    if (selectedPairIds.length === 0) return;
    setExportErrorMessage(null);
    setIsExporting(true);
    try {
      const response = await exportChatWiki(selectedPairIds);
      setPairSelection(EMPTY_CHAT_PAIR_RANGE_SELECTION);
      setIsPairSelectionMode(false);
      try {
        await onDocumentExported?.(response);
        const ingest = response.status === "saved" ? onIngestExportedDocument : undefined;
        publishNotice({
          kind: "completed",
          title: "채팅 편입 완료",
          message: getChatExportSuccessMessage(response.status, Boolean(ingest)),
          subjectIds: [response.exportDocumentId],
          action: ingest ? { label: "위키 편입", onAction: () => ingest(response.exportDocumentId) } : undefined
        });
      } catch (error: unknown) {
        const detail = getErrorMessage(error, "워크스페이스 목록 갱신에 실패했습니다.");
        const message = `문서는 저장했지만 워크스페이스 목록을 갱신하지 못했습니다. 페이지를 새로고침해 주세요. (${detail})`;
        setExportErrorMessage(message);
        publishNotice({ kind: "failed", title: "문서 목록 갱신 실패", message });
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error, "채팅을 문서로 편입하지 못했습니다.");
      setExportErrorMessage(message);
      publishNotice({
        kind: "failed",
        title: "채팅 편입 실패",
        message: `${message} 처리 결과가 불확실할 수 있으니 문서 목록을 확인해 주세요.`
      });
    } finally {
      setIsExporting(false);
    }
  }

  // 편집안이 열린 문서의 것이면 메인 본문에 제안으로 붙이고(Figma 1571:27625), 작업 탭 카드에는 거절·수락만 둔다.
  // 두 곳의 버튼은 같은 결정을 쓴다. 문서가 바뀌었거나 다른 문서면 기존 미리보기 카드로 보여 준다.
  const { reviewSegments, proposalDecisions } = agentTurn;
  const reviewDocumentId = agentTurnRequest?.documentId ?? null;
  const proposalCount = reviewSegments ? countProposals(reviewSegments) : 0;
  const pendingProposalCount = reviewSegments ? countPendingProposals(reviewSegments, proposalDecisions) : 0;
  const isInlineReview = Boolean(
    reviewSegments && proposalCount > 0 && editPreviewState?.preview && !editPreviewState.validationError
    && reviewDocumentId && reviewDocumentId === openDocumentId
  );
  const isReviewBusy = isAgentTurnLoading || isCreatingMarkdown;
  const decideProposalRef = useRef(agentTurn.decideProposal);
  decideProposalRef.current = agentTurn.decideProposal;
  const reviewSourceLabel = proposalSourceLabel(agentTurnRequest?.message ?? "");
  const inlineReview = useMemo<InlineEditReviewState | null>(() => (
    isInlineReview && reviewSegments && reviewDocumentId ? {
      documentId: reviewDocumentId,
      sourceLabel: reviewSourceLabel,
      segments: reviewSegments,
      decisions: proposalDecisions,
      pendingCount: pendingProposalCount,
      isBusy: isReviewBusy,
      onDecide: (index, decision) => decideProposalRef.current(index, decision)
    } : null
  ), [isInlineReview, isReviewBusy, pendingProposalCount, proposalDecisions, reviewDocumentId, reviewSegments, reviewSourceLabel]);
  useEffect(() => {
    onEditReviewChange?.(inlineReview);
  }, [inlineReview, onEditReviewChange]);
  useEffect(() => () => onEditReviewChange?.(null), [onEditReviewChange]);
  const reviewHeading = isInlineReview && agentTurnRequest?.editorSnapshot && agentTurnResponse?.result.edit
    ? headingAtLine(agentTurnRequest.editorSnapshot.markdown, agentTurnResponse.result.edit.actual_target.start_line)
    : null;
  const inlineReviewMeta = isInlineReview
    ? [openDocumentTitle, reviewHeading, `제안 ${pendingProposalCount}개 (본문에 표시)`].filter(Boolean).join(" • ")
    : null;

  // 편집안·새 문서 초안은 작업 탭의 해당 작업 아래에 붙인다.
  const hasDocumentCommandPreview = Boolean(
    (agentTurnResponse?.result.action === "markdown_create" && agentTurnResponse.result.generated_markdown)
    || editPreviewState?.preview
  );
  const documentCommandPreview = hasDocumentCommandPreview ? (
    <>
      {agentTurnResponse?.result.action === "markdown_create" && agentTurnResponse.result.generated_markdown && (
        <MarkdownCreatePreview
          draft={agentTurnResponse.result.generated_markdown}
          notice={agentTurnResponse.result.message}
          isSubmitting={isCreatingMarkdown}
          errorMessage={agentTurn.markdownCreateErrorMessage}
          onCancel={agentTurn.cancelAgentTurnResult}
          onRegenerate={agentTurn.regenerateAgentTurn}
          onCreate={agentTurn.createMarkdownDocument}
        />
      )}
      {isInlineReview && <ProposalDecisionButtons disabled={isReviewBusy} onDecide={agentTurn.decideRemainingProposals} />}
      {editPreviewState?.preview && !isInlineReview && (
        <MarkdownEditPreview
          preview={editPreviewState.preview}
          validationError={editPreviewState.validationError}
          isLoading={isAgentTurnLoading || isCreatingMarkdown}
          onApply={agentTurn.applyMarkdownEdit}
          onCancel={agentTurn.cancelAgentTurnResult}
          onOpenAsNewDocument={agentTurn.openMarkdownEditAsNewDocument}
          onRegenerate={agentTurn.regenerateAgentTurn}
        />
      )}
    </>
  ) : null;

  return (
    <aside
      ref={panelRef}
      className={`agent-panel${isPairSelectionMode ? " is-chat-selecting" : ""}`}
      onClick={(event) => event.stopPropagation()}
    >
      <AgentHeader
        activeView={activeView}
        onViewChange={setActiveView}
        sessionTitle={sessionTitle}
        onClose={onClose}
        activeSessionId={activeSessionId}
        isInteractionLocked={isSubmitting || isExporting}
        canStartWikiExport={exportPairIds.length > 0 && !isSubmitting && !isExporting}
        onStartWikiExport={startPairSelection}
        onSelectSession={(sessionId, title) => {
          setActiveSessionId(sessionId);
          setActiveSessionTitle(title);
          // 이전 세션에서 고른 부분 편입 선택이 새 세션으로 새어나가지 않도록 초기화한다.
          setPairSelection(EMPTY_CHAT_PAIR_RANGE_SELECTION);
          setIsPairSelectionMode(false);
        }}
      />
      <div
        className={styles["agent-view-panel"]}
        role="tabpanel"
        id={AGENT_PANEL_VIEW_IDS[activeView]}
        aria-labelledby={`${AGENT_PANEL_VIEW_IDS[activeView]}-tab`}
      >
        {isWorkView ? (
          // 작업 탭(Figma 1610:9512): 문서 편집·폴더 정리·스킬 실행 요청과 결과를 상태별로 묶어 보여 준다.
          <AgentTaskBody
            items={taskItems}
            pendingTask={isAgentTurnLoading && agentTurnRequest ? {
              request: agentTurnRequest.message,
              stages: agentTurn.agentStages,
              notice: agentTurn.isAgentTurnSlow ? AGENT_TURN_SLOW_MESSAGE : null
            } : null}
            activePreviewTurnId={agentTurnResponse?.requestId ?? null}
            activePreview={documentCommandPreview}
            activePreviewMeta={inlineReviewMeta}
            appliedTurnIds={agentTurn.appliedTurnIds}
            rejectedTurnIds={agentTurn.rejectedTurnIds}
            cancelledTurnIds={agentTurn.cancelledTurnIds}
            onShortenActivePreview={isInlineReview && !isReviewBusy ? () => agentTurn.refineAgentTurn("더 짧게 줄여줘") : undefined}
            errorMessage={agentTurn.agentTurnErrorMessage ?? agentTurn.editPreviewErrorMessage ?? aiModelsErrorMessage}
            isShown={isShown}
            onSaveRequestAsSkill={onSaveRequestAsSkill}
            onOpenFolderOrganize={onOpenFolderOrganize}
            onAnswerSkillQuestion={isSubmitting ? undefined : answerSkillQuestion}
            onRetryTask={isSubmitting ? undefined : retryTask}
            onRecheck={agentTurn.canRecheckAgentTurn ? agentTurn.recheckAgentTurn : undefined}
          />
        ) : isMeetingViewOpen ? (
          <MeetingNotesView session={meeting} onPickRecording={pickRecording} />
        ) : isMeetingListOpen ? (
          <MeetingListView
            onOpen={openMeetingFromList}
            onClose={() => {
              setIsMeetingListOpen(false);
              setMeetingOpenError(null);
            }}
            openErrorMessage={meetingOpenError}
          />
        ) : null}
        {/* 대화는 다른 보기로 바꿔도 마운트해 두어 스크롤 위치·진행 상태를 잃지 않는다. */}
        <div className={styles["agent-view-slot"]} hidden={!isChatVisible}>
          <AgentBody
            messages={chatMessages}
            isLoading={isLoading}
            isCancelling={isCancelling}
            activeSessionId={activeSessionId}
            isShown={isShown && isChatVisible}
            activeTurn={activeTurn}
            queryErrorMessage={aiModelsErrorMessage ?? queryErrorMessage}
            chatLoadErrorMessage={chatLoadErrorMessage}
            animatedMessageId={animatedMessageId}
            queryStages={queryStages}
            onOpenSourceBlocks={onOpenSourceBlocks}
            isPairSelectionMode={isPairSelectionMode}
            pairSelectionKind={pairSelectionKind}
            selectablePairIds={exportPairIds}
            excludedPairIds={excludedPairIds}
            selectedPairIds={selectedPairIds}
            onSelectPair={selectPair}
            nodes={nodes}
          />
        </div>
      </div>
      {isPairSelectionMode ? (
        <div className={styles["chat-selection-actions"]}>
          <div className={styles["chat-selection-toolbar"]}>
            <div className={styles["chat-selection-kind"]} role="group" aria-label="편입 문답 선택 방식">
              {PAIR_SELECTION_KIND_OPTIONS.map(({ kind, label }) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={pairSelectionKind === kind}
                  className={styles["chat-selection-kind-option"]}
                  disabled={isExporting}
                  onClick={() => changePairSelectionKind(kind)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={styles["chat-selection-buttons"]}>
              <button
                type="button"
                className={styles["chat-selection-reset"]}
                aria-label="채팅 선택 다시 하기"
                disabled={isExporting || selectedPairIds.length === 0}
                onClick={() => setPairSelection(EMPTY_CHAT_PAIR_RANGE_SELECTION)}
              >
                <RotateCcw size={16} />
              </button>
              <button type="button" className={styles["chat-selection-cancel"]} disabled={isExporting} onClick={cancelPairSelection}>
                취소
              </button>
              <button
                type="button"
                className={styles["chat-selection-confirm"]}
                aria-label={selectedPairIds.length > 0 ? `${selectedPairIds.length}개 문답 편입 확인` : "편입할 문답을 선택하세요"}
                disabled={isExporting || selectedPairIds.length === 0}
                onClick={() => void acceptExport()}
              >
                확인
              </button>
            </div>
          </div>
          {exportErrorMessage && <p className={styles["chat-selection-error"]} role="alert">{exportErrorMessage}</p>}
        </div>
      ) : null}
      <div className={styles["composer-region"]}>
        {/* 테스트 실행 묶음은 작업 탭에만 보인다(Figma 1671:14585). 채팅 탭으로 바꿔도 자리는 남겨 실행 상태를 잃지 않는다. */}
        {skillTestRunSlotRef && <div ref={skillTestRunSlotRef} className={styles["skill-test-run-slot"]} hidden={!isWorkView} />}
        {/* 회의 화면(Figma 1540:22903)에는 채팅 답변 근거 안내를 띄우지 않는다. */}
        {wikiEvidenceNotice && !isWorkView && !isPairSelectionMode && !isMeetingAreaOpen && (
          <div className={styles["wiki-evidence-notice"]}>
            <p role="status">{wikiEvidenceNotice.message}</p>
            {wikiEvidenceNotice.actionLabel && (
              <button
                type="button"
                disabled={wikiEvidenceNotice.isDisabled}
                title={wikiEvidenceNotice.disabledReason ?? undefined}
                onClick={wikiEvidenceNotice.onIngest}
              >
                {wikiEvidenceNotice.isIngesting ? "위키 편입 중…" : wikiEvidenceNotice.actionLabel}
              </button>
            )}
          </div>
        )}
        {skillPicker.isOpen && (
          <SkillSlashPicker
            groups={skillPicker.groups}
            activeSkillId={skillPicker.activeSkillId}
            statusMessage={skillPicker.statusMessage}
            onPick={skillPicker.pick}
            onHover={skillPicker.setActiveSkillId}
            onManageSkills={onManageSkills}
          />
        )}
        <AgentComposer
          value={composerValue}
          inputLabel={isWorkView ? "작업 요청 입력" : undefined}
          header={isWorkView && openDocumentId ? (
            <div className={styles["task-context-chips"]}>
              {isSourceOptIn ? (
                // '새 문서로 만들기' 스킬: 열린 문서는 기본으로 빼고, 눌러야 원문으로 쓴다.
                isDocumentIncluded ? (
                  <button type="button" className={styles["task-context-chip"]} aria-label="현재 문서를 원문에서 빼기" onClick={() => setOptedInDocumentId(null)}>
                    현재 문서 · 원문으로 사용
                    <AgentAssetIcon src={contextChipCloseIcon} size={12} />
                  </button>
                ) : (
                  <button type="button" className={styles["task-context-chip-add"]} aria-label="현재 문서를 새 문서의 원문으로 쓰기" title="눌러서 새 문서의 원문으로 쓰기" onClick={() => setOptedInDocumentId(openDocumentId)}>
                    현재 문서
                  </button>
                )
              ) : isDocumentIncluded ? (
                <button type="button" className={styles["task-context-chip"]} aria-label="현재 문서를 작업 대상에서 빼기" onClick={() => setExcludedDocumentId(openDocumentId)}>
                  현재 문서
                  <AgentAssetIcon src={contextChipCloseIcon} size={12} />
                </button>
              ) : (
                <button type="button" className={styles["task-context-chip-add"]} onClick={() => setExcludedDocumentId(null)}>
                  + 현재 문서
                </button>
              )}
              {isSelectionIncluded && markdownEditContext && editorTarget && (
                <button type="button" className={`${styles["task-context-chip"]} ${styles["is-primary"]}`} aria-label="선택한 부분을 작업 대상에서 빼기" onClick={() => setExcludedSelectionKey(selectionKey)}>
                  {selectionChipLabel(markdownEditContext.editorSnapshot.markdown, editorTarget.startLine, editorTarget.endLine)}
                  <AgentAssetIcon src={contextChipClosePrimaryIcon} size={12} />
                </button>
              )}
            </div>
          ) : null}
          onInputKeyDown={isWorkView ? skillPicker.handleKeyDown : undefined}
          inputPopup={isWorkView ? {
            isOpen: skillPicker.isOpen,
            listId: SKILL_PICKER_LIST_ID,
            activeOptionId: skillPicker.activeSkillId ? skillPickerOptionId(skillPicker.activeSkillId) : null
          } : undefined}
          isLoading={isSubmitting || isPairSelectionMode}
          placeholder={composerPlaceholder}
          models={aiModels}
          selectedModel={selectedModel}
          modelCatalogStatus={aiModelCatalogStatus}
          // 회의 화면이 열려 있는 동안에는 질문을 보내지 않는다(답이 가려진 채팅에 쌓인다).
          canSubmit={!isPairSelectionMode && !isMeetingAreaOpen && activeSessionId !== null && selectedModel !== null}
          onModelChange={handleModelChange}
          allowWebSearch={allowWebSearch}
          onWebSearchChange={handleWebSearchChange}
          onChange={setComposerValue}
          onSubmit={handleSubmit}
          onCancel={isLoading && !isWorkView ? cancelQuery : undefined}
          isCancelling={isCancelling}
          statusMessage={queryStatusMessage}
          meetingControl={{
            state: isCapturingPhase(meeting.phase) ? "capturing" : meeting.phase === "idle" ? "idle" : "busy",
            onStart: () => {
              setActiveView("chat");
              setIsMeetingListOpen(false);
              void meeting.start();
            },
            onStop: meeting.stop,
            onPickRecording: () => {
              setActiveView("chat");
              setIsMeetingListOpen(false);
              pickRecording();
            },
            onOpenMeetingList: () => {
              setActiveView("chat");
              setMeetingOpenError(null);
              setIsMeetingListOpen(true);
            }
          }}
        />
        <RecordingFileInput ref={recordingInputRef} onSelect={(file) => void meeting.uploadRecording(file)} />
      </div>
    </aside>
  );
}
