import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useUserPreferences } from "@/entities/user";
import taskBoltIcon from "@/shared/assets/svg/agent/task-bolt.svg";
import taskBoltDangerIcon from "@/shared/assets/svg/agent/task-bolt-danger.svg";
import { getWorkspaceId } from "@/shared/api/client";
import type { RunStageEvent } from "@/shared/lib/runEventStream";
import { cx } from "@/shared/lib/classNames";
import { formatRelativeTime } from "@/shared/lib/relativeTime";
import { fetchAgentPlanRun } from "../api/agentPlan";
import { isPlanRunSettled, isWorkspacePlanAction, knownPlanRunId, PLAN_POLL_INTERVAL_MS, shouldPollAgentPlan, summarizePlanOperationResults, type AgentPlanRun } from "../lib/agentPlan";
import { buildProgressSteps } from "../lib/progressSteps";
import { useServerAppliedTurnIds } from "../model/useServerAppliedTurnIds";
import { summarizeFolderOrganizeRows, type FolderOrganizeRequest } from "../lib/folderOrganize";
import { STALLED_TURN_DETAIL, TURN_CANCELLING_DETAIL, TURN_ROLLBACK_FAILED_DETAIL, type TurnCancelState } from "../lib/stalledTurns";
import { supersededFolderPlans, type FolderPlanSupersession } from "../lib/folderPlanSupersede";
import { useSupersedeFolderPlans } from "../model/useSupersedeFolderPlans";
import { newAttentionKeys, revealScrollDelta } from "../lib/revealScroll";
import {
  describeTaskRequest,
  groupTaskEntries,
  resolveTaskRequest,
  resolveTaskStatus,
  SKILL_MODE_CHOICES,
  skillModeAnswer,
  skillModeQuestionSlug,
  supersededTaskKeys,
  TASK_GROUPS,
  taskHeadingKind,
  type TaskGroup,
  type TaskMessageItem,
  type TaskStatusView
} from "../lib/taskThread";
import { AgentPlanTaskDetail } from "./AgentPlanTaskDetail";
import { StatusList } from "./StatusList";
import { AgentAssetIcon } from "./AgentIcons";
import styles from "./AgentChat.module.css";

/** Figma 1610:9608: 완료 묶음 아래 안내 */
const DONE_NOTICE = "작업기록은 LLM Wiki에 들어가지 않습니다. 문서·파일의 변경 이력으로만 남습니다.";
/** 실패한 turn에 서버 안내 문구가 없을 때 */
const FAILED_TASK_FALLBACK = "작업을 처리하지 못했어요. 다시 시도해 주세요.";
/** 새로 생기면 보이도록 굴려 줄 카드 묶음(할 일이 남은 묶음과, 진행 카드가 실패로 끝나 옮겨 간 '실패') */
const ATTENTION_GROUPS: ReadonlySet<TaskGroup> = new Set(["running", "approval", "clarify", "failed"]);
const PENDING_ATTENTION_KEY = "pending";
const PREVIEW_ATTENTION_KEY = "preview";
const NO_TURN_IDS: ReadonlySet<string> = new Set();
const NO_CANCEL_STATES: ReadonlyMap<string, TurnCancelState> = new Map();

export function agentPlanQueryKey(workspaceId: string, turnId: string | null) {
  return ["agentPlan", workspaceId, turnId] as const;
}

type TaskEntry = {
  item: TaskMessageItem;
  status: TaskStatusView;
  title: string;
  /** 사용자가 보낸 원래 요청(스킬 요청이 아니고 run request_summary가 있으면 그 값) */
  request: string;
  /** 스킬 요청("/slug")을 run이 문장으로 정리한 요약. 따옴표 안 문장으로 쓴다. */
  summary: string | null;
  run: AgentPlanRun | null;
  runError: unknown;
  isRunFetching: boolean;
  refetchRun: () => void;
};

/** 완료 행 "저장됨(N) · 제외 M · 새 폴더 K"에 쓸 수. 폴더 정리는 줄 단위, 그 밖의 계획은 작업 단위로 센다. */
function countPlanResults(action: string | null, run: AgentPlanRun | null): { applied: number; excluded: number; createdFolders: number } {
  if (action === "folder_organize" && run?.plan) {
    const { saved, excluded, createdFolders } = summarizeFolderOrganizeRows(run.plan);
    return { applied: saved, excluded, createdFolders };
  }
  const { applied, excluded } = summarizePlanOperationResults(run?.plan?.operations ?? []);
  return { applied, excluded, createdFolders: 0 };
}

/** 작업 한 줄(Figma 1610:9596): 번개 아이콘 + "종류 : 요청" 왼쪽, 상태 오른쪽. 거절·실패는 빨간 취소선 */
function TaskRow({ title, status }: { title: string; status: TaskStatusView }) {
  const isDanger = status.tone === "danger";
  return (
    <div className={cx(styles["task-row"], isDanger && styles["is-danger"], status.struck && styles["is-struck"], status.tone === "muted" && styles["is-muted"])}>
      <span className={styles["task-row-title"]} title={title}>
        <AgentAssetIcon src={isDanger ? taskBoltDangerIcon : taskBoltIcon} size={12} />
        <span>{title}</span>
      </span>
      <span className={styles["task-row-status"]}>{status.label}</span>
    </div>
  );
}

function TaskNote({ children, role }: { children: ReactNode; role?: "alert" | "status" }) {
  return <p className={styles["task-note"]} role={role}>{children}</p>;
}

/**
 * 할 일이 남은 작업 카드(Figma 1671:13219): 번개 + "종류 : /스킬"과 시각, 따옴표 안 요청, 보조 설명,
 * 그 아래 미리보기·버튼. 되묻는 작업(1671:13252)은 질문을 제목으로 쓴다.
 */
function TaskCard({
  action,
  request,
  createdAt,
  title,
  summary = null,
  meta,
  children
}: {
  action: string | null;
  request: string;
  createdAt: string | null;
  /** 없으면 따옴표 안 요청 */
  title?: string;
  /** 스킬 요청에 덧붙인 문장이 없을 때 따옴표 안에 대신 쓸 run 요약 */
  summary?: string | null;
  meta?: string | null;
  children?: ReactNode;
}) {
  const { heading, quote } = describeTaskRequest(action, request);
  const shownQuote = summary && quote === request.trim() ? summary : quote;
  return (
    <article className={styles["task-card"]}>
      <header className={styles["task-card-head"]}>
        <span className={styles["task-card-kind"]}>
          <AgentAssetIcon src={taskBoltIcon} size={12} />
          <span>{heading}</span>
        </span>
        {createdAt && <time dateTime={createdAt}>{formatRelativeTime(createdAt)}</time>}
      </header>
      <p className={styles["task-card-title"]}>{title ?? `"${shownQuote}"`}</p>
      {meta && <p className={styles["task-card-meta"]}>{meta}</p>}
      {children}
    </article>
  );
}

/** 아직 서버 기록에 없는, 이 화면에서 보내 처리 중이거나 보내려고 기다리는 요청 */
export type PendingTaskView = {
  request: string;
  stages: RunStageEvent[];
  notice?: string | null;
  /** 서버가 정한 turn ID. 같은 turn의 서버 기록(pending 메시지)은 이 카드로 대신해 두 번 보이지 않게 한다. */
  turnId?: string | null;
  /** 진행 단계가 없을 때 보일 문장. 없으면 "요청을 전달하고 있어요." */
  waitingLabel?: string | null;
  /** 카드 아래 버튼(기다리는 스킬 실행의 '실행 취소' 등) */
  actions?: ReactNode;
};

/**
 * 작업 탭 본문(Figma 1671:13216·1610:9529): 상태별 묶음(진행 중·확인 필요·선택 필요·실패)은 작업 카드로,
 * 완료는 한 줄 목록과 안내로 보여 준다. 폴더 정리 계획은 turn→run을 따라가 상태를 받는다.
 */
export function AgentTaskBody({
  items,
  pendingTask,
  activePreviewTurnId,
  activePreview,
  activePreviewMeta = null,
  appliedTurnIds,
  rejectedTurnIds,
  cancelledTurnIds,
  errorMessage,
  isShown,
  onSaveRequestAsSkill,
  onOpenFolderOrganize,
  onShortenActivePreview,
  onAnswerSkillQuestion,
  onRetryTask,
  onRecheck,
  stalledTurnIds = NO_TURN_IDS,
  releasedTurnIds = NO_TURN_IDS,
  closingTurnIds = NO_TURN_IDS,
  onRetryStalled,
  onDismissStalled,
  onRetryFailed,
  cancelAcceptedTurnIds = NO_TURN_IDS,
  cancelStates = NO_CANCEL_STATES,
  onFolderPlanSuperseded
}: {
  items: TaskMessageItem[];
  pendingTask: PendingTaskView | null;
  /** 편집안·새 문서 초안을 검토 중인 turn과 그 미리보기 */
  activePreviewTurnId: string | null;
  activePreview: ReactNode;
  /** 검토 중인 카드의 보조 설명(Figma 1610:9145 "문서 • 섹션 • 제안 N개 (본문에 표시)"). 없으면 상태 문구 */
  activePreviewMeta?: string | null;
  appliedTurnIds: ReadonlySet<string>;
  /** 편집안을 모두 거절한 turn(이 사람의 브라우저에 남긴 기록 포함) */
  rejectedTurnIds: ReadonlySet<string>;
  /** 편집안·새 문서 초안을 취소한 turn */
  cancelledTurnIds: ReadonlySet<string>;
  errorMessage: string | null;
  isShown: boolean;
  /** "이 요청을 스킬로 저장"(Figma 1671:13245). 없으면 버튼을 숨긴다. */
  onSaveRequestAsSkill?: (request: string) => void;
  /** 폴더 정리 계획을 메인 영역의 미리보기 탭으로 연다(Figma 1656:11542). */
  onOpenFolderOrganize?: (request: FolderOrganizeRequest) => void;
  /** 검토 중인 편집안을 "더 짧게" 다시 받는다(Figma 1610:9183). 없으면 버튼을 숨긴다. */
  onShortenActivePreview?: () => void;
  /** 스킬 되묻기(새 문서·문서 수정)에 고른 답(`/slug …`)을 같은 대상으로 보낸다. 없으면 선택 버튼을 숨긴다. */
  onAnswerSkillQuestion?: (request: string, createsDocument: boolean) => void;
  /** 계획 단계에서 실패한 작업을 같은 요청·대상 폴더로 다시 보낸다. 없으면 "다시 시도"를 숨긴다. */
  onRetryTask?: (request: string, folderId: string | null) => void;
  /** 결과 확인이 끊긴 작업의 끝을 다시 확인한다. 있으면 오류 문구 아래에 "다시 확인"을 둔다. */
  onRecheck?: () => void;
  /** 응답을 받지 못한(pending에 머문) turn */
  stalledTurnIds?: ReadonlySet<string>;
  /** 응답을 받지 못해 닫은 turn */
  releasedTurnIds?: ReadonlySet<string>;
  /** 닫기(서버 취소 요청) 중인 turn */
  closingTurnIds?: ReadonlySet<string>;
  /** 응답을 받지 못한 작업을 같은 요청으로 다시 보낸다. 없으면 "다시 시도"를 숨긴다. */
  onRetryStalled?: (item: TaskMessageItem) => void;
  /** 응답을 받지 못한 작업을 닫아 입력 잠금을 푼다. */
  onDismissStalled?: (turnId: string) => void;
  /** 실패로 끝난 작업(계획이 아닌 편집·스킬 실행)을 같은 요청으로 다시 보낸다. 없으면 "다시 시도"를 숨긴다. */
  onRetryFailed?: (item: TaskMessageItem) => void;
  /** 닫기·중지로 보낸 취소를 서버가 받아들인 turn. 목록이 아직 pending이어도 "취소됨"으로 보인다. */
  cancelAcceptedTurnIds?: ReadonlySet<string>;
  /** 취소한 turn을 조회해 받은 취소 진행 상태. 취소하는 중이면 "취소하는 중…", 복구 실패면 '실패' 묶음에 보인다. */
  cancelStates?: ReadonlyMap<string, TurnCancelState>;
  /** 앞선 승인 대기 계획을 새 계획으로 대체해 서버에 거절했다. question은 새 run을 보낸 요청이다. */
  onFolderPlanSuperseded?: (supersession: FolderPlanSupersession & { question: string }) => void;
}) {
  const workspaceId = getWorkspaceId();
  const client = useQueryClient();
  const { reduceMotion } = useUserPreferences();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // 진행 카드가 대신 보여 주는 turn의 서버 기록은 빼서 같은 작업이 두 장 보이지 않게 한다.
  const pendingTurnId = pendingTask?.turnId ?? null;
  const visibleItems = pendingTurnId ? items.filter((item) => item.turnId !== pendingTurnId) : items;
  const planItems = visibleItems.filter((item) => isWorkspacePlanAction(item.action ?? undefined) && item.messageStatus === "completed");
  const runQueries = useQueries({
    queries: planItems.map((item) => ({
      queryKey: agentPlanQueryKey(workspaceId, item.turnId),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchAgentPlanRun(
        workspaceId,
        item.turnId!,
        signal,
        knownPlanRunId(client.getQueryData<AgentPlanRun | null>(agentPlanQueryKey(workspaceId, item.turnId)), item.turnId!)
      ),
      enabled: Boolean(item.turnId) && isShown,
      retry: false,
      refetchInterval: (query: { state: { error: unknown; data?: AgentPlanRun | null } }) =>
        !query.state.error && shouldPollAgentPlan(query.state.data?.status ?? undefined) ? PLAN_POLL_INTERVAL_MS : false,
      // 이미 끝난 계획은 상태가 바뀌지 않으므로 다시 마운트돼도 다시 받지 않는다(#66).
      staleTime: (query: { state: { data?: AgentPlanRun | null } }) =>
        shouldPollAgentPlan(query.state.data?.status ?? undefined) ? 0 : Infinity
    }))
  });
  const runsByKey = new Map(planItems.map((item, index) => [item.key, runQueries[index]]));
  // 같은 스킬·요청이라도 대상 폴더가 같아야 다시 실행으로 본다. 대상을 모르는 작업(계획을 아직 못 받음 등)은 정리하지 않는다.
  const supersededKeys = supersededTaskKeys(visibleItems, (item) => runsByKey.get(item.key)?.data?.target_folder_id);
  // 같은 폴더에 새 계획이 승인 대기에 도달하면 앞선 승인 대기 계획을 거절해 확인 필요 카드가 두 장 남지 않게 한다.
  const planEntries = planItems.map((item, index) => ({ turnId: item.turnId, action: item.action, run: runQueries[index]?.data ?? null }));
  useSupersedeFolderPlans({
    workspaceId,
    entries: planEntries,
    onSuperseded: (supersession) => {
      const newer = planItems.find((item) => item.turnId === supersession.supersededBy);
      const newerRun = newer ? runsByKey.get(newer.key)?.data : null;
      onFolderPlanSuperseded?.({ ...supersession, question: resolveTaskRequest(newer?.request, newerRun?.request_summary).request });
    }
  });
  // 거절 응답 전(승인 대기)에도, 거절된 뒤 새로 고침해도 같은 폴더의 새 계획에 대체된 계획은 "새 실행으로 대체됨"으로 보인다.
  const supersededPlanTurnIds = new Set(supersededFolderPlans(planEntries, { includeRejected: true }).map(({ turnId }) => turnId));
  // 새로 고침 뒤에도 적용한 편집안이 "저장됨"으로 남게 서버 버전 기록으로 다시 확인한다.
  const serverAppliedTurnIds = useServerAppliedTurnIds(workspaceId, visibleItems, isShown);

  // 실행이 끝나는 전이를 볼 때만 문서·트리·그래프를 다시 받는다(#66).
  const runStatusSignature = runQueries.map((query) => query.data?.status ?? "").join("|");
  const previousStatuses = useRef<string[]>([]);
  useEffect(() => {
    const statuses = runStatusSignature.split("|");
    const settled = statuses.some((status, index) => isPlanRunSettled(previousStatuses.current[index] || undefined, status || undefined));
    if (settled) void client.invalidateQueries({ queryKey: ["backendData"] });
    previousStatuses.current = statuses;
  }, [client, runStatusSignature]);

  const entries: TaskEntry[] = visibleItems.map((item, index) => {
    const query = runsByKey.get(item.key);
    const run = query?.data ?? null;
    // 계획 전체 수가 아니라 실제로 저장된 작업만 센다(고르지 않은·실패한 작업 제외).
    // 폴더 정리는 미리보기("4개 중 3개 선택")처럼 줄(문서·항목) 단위로 세고 새 폴더는 따로 적는다.
    const results = countPlanResults(item.action, run);
    const status = resolveTaskStatus({
      action: item.action,
      messageStatus: item.messageStatus,
      runStatus: run?.status,
      operationCount: results.applied,
      excludedCount: results.excluded,
      createdFolderCount: results.createdFolders,
      isSuperseded: supersededKeys.has(item.key),
      isStalled: item.turnId !== null && stalledTurnIds.has(item.turnId),
      isReleased: item.turnId !== null && releasedTurnIds.has(item.turnId),
      isCancelAccepted: item.turnId !== null && cancelAcceptedTurnIds.has(item.turnId),
      cancelState: item.turnId !== null ? cancelStates.get(item.turnId) ?? null : null,
      isPlanSuperseded: item.turnId !== null && supersededPlanTurnIds.has(item.turnId),
      hasActivePreview: Boolean(activePreview) && item.turnId !== null && item.turnId === activePreviewTurnId,
      isApplied: item.turnId !== null && (appliedTurnIds.has(item.turnId) || serverAppliedTurnIds.has(item.turnId)),
      isRejected: item.turnId !== null && rejectedTurnIds.has(item.turnId),
      isCancelled: item.turnId !== null && cancelledTurnIds.has(item.turnId),
      hasLaterTask: index < visibleItems.length - 1 || Boolean(pendingTask)
    });
    const { request, summary } = resolveTaskRequest(item.request, run?.request_summary);
    return {
      item,
      status,
      // 스킬 실행은 진행 중·완료 카드 머리글과 같이 "문서 : /slug"로 적는다(Figma 1571:27625 완료 행).
      title: `${taskHeadingKind(item.action, request)} : ${request}`,
      request,
      summary,
      run,
      runError: query?.error ?? null,
      isRunFetching: query?.isFetching ?? false,
      refetchRun: () => { void query?.refetch(); }
    };
  });
  const sections = groupTaskEntries(entries);
  const hasPreviewEntry = entries.some((entry) => entry.status.group === "approval" && entry.item.turnId === activePreviewTurnId);

  const isOrphanPreview = Boolean(activePreview) && !hasPreviewEntry;
  // 새 진행·확인·선택 필요·실패 카드가 생기면 그 카드 전체가 보이게 굴린다. 처음 그릴 때는 굴리지 않는다(할 일 묶음이 위에 있다).
  const attentionKeys = [
    ...entries.filter((entry) => ATTENTION_GROUPS.has(entry.status.group)).map((entry) => entry.item.key),
    ...(isOrphanPreview ? [PREVIEW_ATTENTION_KEY] : []),
    ...(pendingTask ? [PENDING_ATTENTION_KEY] : [])
  ];
  const attentionSignature = attentionKeys.join("|");
  const seenAttentionKeys = useRef<ReadonlySet<string> | null>(null);
  const pendingStageCount = pendingTask?.stages.length ?? 0;
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const keys = attentionSignature ? attentionSignature.split("|") : [];
    const previous = seenAttentionKeys.current;
    seenAttentionKeys.current = new Set(keys);
    if (!body || !previous) return;
    const target = newAttentionKeys(previous, keys).at(-1);
    if (!target) return;
    const frameId = window.requestAnimationFrame(() => revealAttentionCard(body, target, reduceMotion));
    return () => window.cancelAnimationFrame(frameId);
  }, [attentionSignature, reduceMotion]);
  // 진행 카드가 단계가 늘어 길어지면, 보고 있던(머리글이 보이는) 카드가 잘리지 않게 다시 맞춘다.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || pendingStageCount === 0) return;
    const frameId = window.requestAnimationFrame(() => {
      const card = findAttentionCard(body, PENDING_ATTENTION_KEY);
      if (!card) return;
      const bodyBox = body.getBoundingClientRect();
      const cardTop = card.getBoundingClientRect().top;
      if (cardTop >= bodyBox.top && cardTop < bodyBox.bottom) revealAttentionCard(body, PENDING_ATTENTION_KEY, reduceMotion);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [pendingStageCount, reduceMotion]);

  function renderDetail(entry: TaskEntry) {
    const { item, status } = entry;
    const cancelState = item.turnId !== null ? cancelStates.get(item.turnId) : undefined;
    const isCancelledTurn = item.messageStatus === "cancelled" || (item.messageStatus === "pending" && item.turnId !== null && cancelAcceptedTurnIds.has(item.turnId));
    if (isCancelledTurn && (cancelState === "requested" || cancelState === "rolling_back")) {
      return <TaskNote role="status">{TURN_CANCELLING_DETAIL[cancelState]}</TaskNote>;
    }
    if (isCancelledTurn && cancelState === "rollback_failed") return <TaskNote role="alert">{TURN_ROLLBACK_FAILED_DETAIL}</TaskNote>;
    if (isWorkspacePlanAction(item.action ?? undefined) && status.group !== "done") {
      return (
        <AgentPlanTaskDetail
          turnId={item.turnId}
          action={item.action ?? ""}
          run={entry.run}
          runError={entry.runError}
          isRunFetching={entry.isRunFetching}
          onRefetch={entry.refetchRun}
          onRetry={onRetryTask && item.request
            ? () => onRetryTask(item.request, entry.run?.target_folder_id ?? null)
            : undefined}
          onOpenPreview={item.action === "folder_organize" && item.turnId && onOpenFolderOrganize
            ? () => onOpenFolderOrganize({ turnId: item.turnId!, question: entry.request })
            : undefined}
        />
      );
    }
    if (status.group === "approval" && item.turnId === activePreviewTurnId) return activePreview;
    if (item.turnId !== null && stalledTurnIds.has(item.turnId) && item.messageStatus === "pending") {
      return <TaskNote role="alert">{STALLED_TURN_DETAIL}</TaskNote>;
    }
    if (status.group === "failed" && item.answer) return <TaskNote role="alert">{item.answer}</TaskNote>;
    if (item.messageStatus === "failed") return <TaskNote role="alert">{FAILED_TASK_FALLBACK}</TaskNote>;
    return null;
  }

  function renderCard(entry: TaskEntry) {
    const { item, status } = entry;
    // 되묻는 작업은 AI 질문을 제목으로, 원래 요청을 보조 설명으로 둔다(Figma 1671:13261).
    const isQuestion = status.group === "clarify" && item.action === "clarify" && Boolean(item.answer);
    const isActivePreview = status.group === "approval" && item.turnId === activePreviewTurnId;
    const questionSlug = isQuestion ? skillModeQuestionSlug(item) : null;
    const stalledTurnId = status.group === "failed" && item.messageStatus === "pending" && item.turnId !== null && stalledTurnIds.has(item.turnId)
      ? item.turnId
      : null;
    // 계획(폴더 정리 등)은 계획 상세가 "다시 시도"를 둔다. 그 밖의 실패한 turn(편집·스킬 실행)은 여기서 같은 요청으로 다시 보낸다.
    const canRetryFailed = item.messageStatus === "failed" && !isWorkspacePlanAction(item.action ?? undefined)
      && Boolean(item.request) && Boolean(onRetryFailed);
    return (
      <div
        key={item.key}
        className={styles["task-entry"]}
        data-attention-key={ATTENTION_GROUPS.has(status.group) ? item.key : undefined}
      >
        <TaskCard
          action={item.action}
          request={entry.request}
          summary={entry.summary}
          createdAt={item.createdAt}
          title={isQuestion ? item.answer : undefined}
          meta={isQuestion ? `요청 : ${entry.request}` : (isActivePreview && activePreviewMeta) || status.label}
        >
          {renderDetail(entry)}
        </TaskCard>
        {questionSlug && onAnswerSkillQuestion && (
          <div className={styles["task-actions"]}>
            {SKILL_MODE_CHOICES.map((choice) => (
              <button
                key={choice.label}
                type="button"
                className={cx(styles["task-pill"], styles["is-primary"])}
                onClick={() => onAnswerSkillQuestion(skillModeAnswer(questionSlug, choice), choice.createsDocument)}
              >
                <AgentAssetIcon src={taskBoltIcon} size={12} />
                {choice.label}
              </button>
            ))}
          </div>
        )}
        {canRetryFailed && (
          <div className={styles["task-actions"]}>
            <button type="button" className={cx(styles["task-pill"], styles["is-primary"])} onClick={() => onRetryFailed?.(item)}>
              <AgentAssetIcon src={taskBoltIcon} size={12} />
              다시 시도
            </button>
          </div>
        )}
        {stalledTurnId && (onRetryStalled || onDismissStalled) && (
          <div className={styles["task-actions"]}>
            {onRetryStalled && (
              <button type="button" className={cx(styles["task-pill"], styles["is-primary"])} disabled={closingTurnIds.has(stalledTurnId)} onClick={() => onRetryStalled(item)}>
                <AgentAssetIcon src={taskBoltIcon} size={12} />
                다시 시도
              </button>
            )}
            {onDismissStalled && (
              <button
                type="button"
                className={styles["task-pill"]}
                disabled={closingTurnIds.has(stalledTurnId)}
                aria-busy={closingTurnIds.has(stalledTurnId) || undefined}
                onClick={() => onDismissStalled(stalledTurnId)}
              >
                {closingTurnIds.has(stalledTurnId) ? "닫는 중…" : "닫기"}
              </button>
            )}
          </div>
        )}
        {status.group === "approval" && (onSaveRequestAsSkill || (isActivePreview && onShortenActivePreview)) && (
          <div className={styles["task-actions"]}>
            {isActivePreview && onShortenActivePreview && (
              <button type="button" className={cx(styles["task-pill"], styles["is-primary"])} onClick={onShortenActivePreview}>
                <AgentAssetIcon src={taskBoltIcon} size={12} />
                더 짧게
              </button>
            )}
            {onSaveRequestAsSkill && (
              <button type="button" className={cx(styles["task-pill"], styles["is-primary"])} onClick={() => onSaveRequestAsSkill(entry.request)}>
                <AgentAssetIcon src={taskBoltIcon} size={12} />
                이 요청을 스킬로 저장
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const isEmpty = sections.length === 0 && !pendingTask && !isOrphanPreview;
  // 묶음 순서(진행 중 → 확인 필요 → 선택 필요 → 실패 → 완료)를 지킨다. 서버 기록에 붙기 전의 진행 카드는 '진행 중' 묶음에,
  // 서버 기록에 붙기 전의 편집안(응답 직후 목록을 다시 받는 사이)은 '확인 필요' 묶음에 함께 둔다.
  const extraByGroup: Partial<Record<TaskGroup, ReactNode>> = {
    running: pendingTask && (
      <div className={styles["task-entry"]} data-attention-key={PENDING_ATTENTION_KEY} aria-live="polite">
        <TaskCard action={null} request={pendingTask.request} createdAt={null}>
          <StatusList
            title="요청 처리 중"
            isLoading
            hasResponse={false}
            steps={pendingTask.stages.length
              ? buildProgressSteps(pendingTask.stages, true)
              : [[pendingTask.waitingLabel || "요청을 전달하고 있어요.", "active"]]}
          />
          {pendingTask.notice && <TaskNote role="status">{pendingTask.notice}</TaskNote>}
        </TaskCard>
        {pendingTask.actions && <div className={styles["task-actions"]}>{pendingTask.actions}</div>}
      </div>
    ),
    approval: isOrphanPreview && <div className={styles["task-entry"]} data-attention-key={PREVIEW_ATTENTION_KEY}>{activePreview}</div>
  };
  const sectionEntries = new Map(sections.map((section) => [section.group, section.entries]));
  return (
    <div className={styles["task-body"]} ref={bodyRef}>
      {isEmpty && (
        <div className={styles["task-empty"]}>
          <p>문서 편집·폴더 정리·스킬 실행을 요청해 보세요.</p>
          <p>/를 입력하면 스킬을 고를 수 있어요. 위키 내용 질문은 채팅 탭에서 할 수 있어요.</p>
        </div>
      )}
      {TASK_GROUPS.map(({ group, label }) => {
        const groupEntries = sectionEntries.get(group) ?? [];
        const extra = extraByGroup[group];
        if (groupEntries.length === 0 && !extra) return null;
        return (
          <section key={group} className={styles["task-section"]} aria-label={label}>
            <p className={styles["task-section-label"]}>{label}</p>
            {group === "done" ? (
              <>
                <div className={styles["task-rows"]}>
                  {groupEntries.map((entry) => <TaskRow key={entry.item.key} title={entry.title} status={entry.status} />)}
                </div>
                <TaskNote>{DONE_NOTICE}</TaskNote>
              </>
            ) : groupEntries.map(renderCard)}
            {extra}
          </section>
        );
      })}
      {errorMessage && <p className={styles["query-error"]} role="alert">{errorMessage}</p>}
      {errorMessage && onRecheck && (
        <div className={styles["task-actions"]}>
          <button type="button" className={cx(styles["task-pill"], styles["is-primary"])} onClick={onRecheck}>
            <AgentAssetIcon src={taskBoltIcon} size={12} />
            결과 다시 확인
          </button>
        </div>
      )}
    </div>
  );
}

function findAttentionCard(body: HTMLElement, key: string): HTMLElement | null {
  return [...body.querySelectorAll<HTMLElement>("[data-attention-key]")].find((element) => element.dataset.attentionKey === key) ?? null;
}

/** 작업 목록 안에서 그 카드 전체가 보이게 굴린다. 움직임 줄이기면 바로 옮긴다. */
function revealAttentionCard(body: HTMLElement, key: string, reduceMotion: boolean) {
  const card = findAttentionCard(body, key);
  if (!card) return;
  const delta = revealScrollDelta(body.getBoundingClientRect(), card.getBoundingClientRect());
  if (delta !== 0) body.scrollBy({ top: delta, behavior: reduceMotion ? "auto" : "smooth" });
}
