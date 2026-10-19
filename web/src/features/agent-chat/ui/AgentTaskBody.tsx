import { Fragment, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import taskBoltIcon from "@/shared/assets/svg/agent/task-bolt.svg";
import taskBoltDangerIcon from "@/shared/assets/svg/agent/task-bolt-danger.svg";
import { getWorkspaceId } from "@/shared/api/client";
import type { RunStageEvent } from "@/shared/lib/runEventStream";
import { cx } from "@/shared/lib/classNames";
import { formatRelativeTime } from "@/shared/lib/relativeTime";
import { OptionSelect } from "@/shared/ui/OptionSelect";
import { fetchAgentPlanRun } from "../api/agentPlan";
import { isPlanRunSettled, isWorkspacePlanAction, shouldPollAgentPlan, type AgentPlanRun } from "../lib/agentPlan";
import { buildProgressSteps } from "../lib/progressSteps";
import { useServerAppliedTurnIds } from "../model/useServerAppliedTurnIds";
import type { FolderOrganizeRequest } from "../lib/folderOrganize";
import { describeTaskRequest, groupTaskEntries, resolveTaskStatus, taskKindLabel, TASK_GROUPS, type TaskMessageItem, type TaskStatusView } from "../lib/taskThread";
import { AgentPlanTaskDetail } from "./AgentPlanTaskDetail";
import { StatusList } from "./StatusList";
import { AgentAssetIcon } from "./AgentIcons";
import styles from "./AgentChat.module.css";

/** Figma 1610:9608: 완료 묶음 아래 안내 */
const DONE_NOTICE = "작업기록은 LLM Wiki에 들어가지 않습니다. 문서·파일의 변경 이력으로만 남습니다.";
const PLAN_POLL_INTERVAL_MS = 3000;

export function agentPlanQueryKey(workspaceId: string, turnId: string | null) {
  return ["agentPlan", workspaceId, turnId] as const;
}

type TaskEntry = {
  item: TaskMessageItem;
  status: TaskStatusView;
  title: string;
  /** 사용자가 보낸 원래 요청(run request_summary가 있으면 그 값) */
  request: string;
  run: AgentPlanRun | null;
  runError: unknown;
  isRunFetching: boolean;
  refetchRun: () => void;
};

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

/** 스킬 실행 대상 문서 고르기(useSkillRun). 작업 탭 "선택 필요" 묶음에 카드로 붙는다. */
export type SkillTargetPicker = {
  /** 스킬 종류 라벨(문서·폴더 정리·템플릿) */
  kindLabel: string;
  slug: string;
  description: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  isCreating: boolean;
  errorMessage: string | null;
  onPick: (documentId: string) => void;
  onCreateDocument: () => void;
  onCancel: () => void;
};

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
  meta,
  heading: headingOverride,
  children
}: {
  /** 없으면 action·요청에서 만든 "종류 : /스킬" */
  heading?: string;
  action: string | null;
  request: string;
  createdAt: string | null;
  /** 없으면 따옴표 안 요청 */
  title?: string;
  meta?: string | null;
  children?: ReactNode;
}) {
  const described = describeTaskRequest(action, request);
  const heading = headingOverride ?? described.heading;
  const { quote } = described;
  return (
    <article className={styles["task-card"]}>
      <header className={styles["task-card-head"]}>
        <span className={styles["task-card-kind"]}>
          <AgentAssetIcon src={taskBoltIcon} size={12} />
          <span>{heading}</span>
        </span>
        {createdAt && <time dateTime={createdAt}>{formatRelativeTime(createdAt)}</time>}
      </header>
      <p className={styles["task-card-title"]}>{title ?? `"${quote}"`}</p>
      {meta && <p className={styles["task-card-meta"]}>{meta}</p>}
      {children}
    </article>
  );
}

/**
 * 스킬 실행 대상 고르기 카드("선택 필요", Figma 1671:13216 카드 + 1610:9350 드롭다운).
 * 문서를 고르거나 "+ 새 문서로 만들기"로 빈 문서를 만들면 그 문서를 열고 입력창에 "/slug "를 채운다.
 */
function SkillTargetTaskCard({ target }: { target: SkillTargetPicker }) {
  const placeholder = target.isCreating
    ? "새 문서를 만드는 중…"
    : target.options.length > 0 ? "문서 선택" : "실행할 수 있는 Markdown 문서가 없어요";
  return (
    <div className={styles["task-entry"]}>
      <TaskCard
        action={null}
        heading={`${target.kindLabel} : /${target.slug}`}
        request={`/${target.slug}`}
        createdAt={null}
        title="어느 문서에 실행할까요?"
        meta={target.description.trim() || null}
      >
        <OptionSelect
          value={null}
          placeholder={placeholder}
          options={target.options}
          disabled={target.isCreating}
          action={{ label: "새 문서로 만들기", disabled: target.isCreating, onSelect: target.onCreateDocument }}
          onChange={target.onPick}
        />
        {target.errorMessage && <p className={styles["task-error"]} role="alert">{target.errorMessage}</p>}
        <div className={styles["task-decisions"]}>
          <button type="button" className={styles["task-pill"]} disabled={target.isCreating} onClick={target.onCancel}>
            취소
          </button>
        </div>
      </TaskCard>
    </div>
  );
}

/**
 * 작업 탭 본문(Figma 1671:13216·1610:9529): 상태별 묶음(진행 중·확인 필요·선택 필요·실패)은 작업 카드로,
 * 완료는 한 줄 목록과 안내로 보여 준다. 폴더 정리 계획은 turn→run을 따라가 상태를 받는다.
 */
export function AgentTaskBody({
  items,
  pendingTask,
  activePreviewTurnId,
  activePreview,
  appliedTurnIds,
  errorMessage,
  isShown,
  onSaveRequestAsSkill,
  onOpenFolderOrganize,
  skillTarget = null
}: {
  items: TaskMessageItem[];
  /** 아직 서버 기록에 없는, 이 화면에서 보내 처리 중인 요청 */
  pendingTask: { request: string; stages: RunStageEvent[] } | null;
  /** 편집안·새 문서 초안을 검토 중인 turn과 그 미리보기 */
  activePreviewTurnId: string | null;
  activePreview: ReactNode;
  appliedTurnIds: ReadonlySet<string>;
  errorMessage: string | null;
  isShown: boolean;
  /** "이 요청을 스킬로 저장"(Figma 1671:13245). 없으면 버튼을 숨긴다. */
  onSaveRequestAsSkill?: (request: string) => void;
  /** 폴더 정리 계획을 메인 영역의 미리보기 탭으로 연다(Figma 1656:11542). */
  onOpenFolderOrganize?: (request: FolderOrganizeRequest) => void;
  /** 스킬 실행 대상 문서 고르기. 있으면 "선택 필요" 묶음에 카드를 붙인다. */
  skillTarget?: SkillTargetPicker | null;
}) {
  const workspaceId = getWorkspaceId();
  const client = useQueryClient();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const planItems = items.filter((item) => isWorkspacePlanAction(item.action ?? undefined) && item.messageStatus === "completed");
  const runQueries = useQueries({
    queries: planItems.map((item) => ({
      queryKey: agentPlanQueryKey(workspaceId, item.turnId),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchAgentPlanRun(workspaceId, item.turnId!, signal),
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
  // 새로 고침 뒤에도 적용한 편집안이 "저장됨"으로 남게 서버 버전 기록으로 다시 확인한다.
  const serverAppliedTurnIds = useServerAppliedTurnIds(workspaceId, items, isShown);

  // 실행이 끝나는 전이를 볼 때만 문서·트리·그래프를 다시 받는다(#66).
  const runStatusSignature = runQueries.map((query) => query.data?.status ?? "").join("|");
  const previousStatuses = useRef<string[]>([]);
  useEffect(() => {
    const statuses = runStatusSignature.split("|");
    const settled = statuses.some((status, index) => isPlanRunSettled(previousStatuses.current[index] || undefined, status || undefined));
    if (settled) void client.invalidateQueries({ queryKey: ["backendData"] });
    previousStatuses.current = statuses;
  }, [client, runStatusSignature]);

  const entries: TaskEntry[] = items.map((item, index) => {
    const query = runsByKey.get(item.key);
    const run = query?.data ?? null;
    const status = resolveTaskStatus({
      action: item.action,
      messageStatus: item.messageStatus,
      runStatus: run?.status,
      operationCount: run?.plan?.operations.length ?? 0,
      hasActivePreview: Boolean(activePreview) && item.turnId !== null && item.turnId === activePreviewTurnId,
      isApplied: item.turnId !== null && (appliedTurnIds.has(item.turnId) || serverAppliedTurnIds.has(item.turnId)),
      hasLaterTask: index < items.length - 1 || Boolean(pendingTask)
    });
    const request = run?.request_summary?.trim().normalize("NFC") || item.request || "요청 내용 없음";
    return {
      item,
      status,
      title: `${taskKindLabel(item.action)} : ${request}`,
      request,
      run,
      runError: query?.error ?? null,
      isRunFetching: query?.isFetching ?? false,
      refetchRun: () => { void query?.refetch(); }
    };
  });
  const sections = groupTaskEntries(entries);
  const hasPreviewEntry = entries.some((entry) => entry.status.group === "approval" && entry.item.turnId === activePreviewTurnId);

  // 새 작업·미리보기가 생기면 목록 아래(입력창 쪽)로 내린다.
  const lastKey = `${items.at(-1)?.key ?? ""}|${pendingTask ? "pending" : ""}|${activePreviewTurnId ?? ""}|${skillTarget ? "skill-target" : ""}`;
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const frameId = window.requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
    return () => window.cancelAnimationFrame(frameId);
  }, [lastKey]);

  function renderDetail(entry: TaskEntry) {
    const { item, status } = entry;
    if (isWorkspacePlanAction(item.action ?? undefined) && status.group !== "done") {
      return (
        <AgentPlanTaskDetail
          turnId={item.turnId}
          action={item.action ?? ""}
          run={entry.run}
          runError={entry.runError}
          isRunFetching={entry.isRunFetching}
          onRefetch={entry.refetchRun}
          onOpenPreview={item.action === "folder_organize" && item.turnId && onOpenFolderOrganize
            ? () => onOpenFolderOrganize({ turnId: item.turnId!, question: entry.request })
            : undefined}
        />
      );
    }
    if (status.group === "approval" && item.turnId === activePreviewTurnId) return activePreview;
    if (status.group === "failed" && item.answer) return <TaskNote role="alert">{item.answer}</TaskNote>;
    return null;
  }

  function renderCard(entry: TaskEntry) {
    const { item, status } = entry;
    // 되묻는 작업은 AI 질문을 제목으로, 원래 요청을 보조 설명으로 둔다(Figma 1671:13261).
    const isQuestion = status.group === "clarify" && item.action === "clarify" && Boolean(item.answer);
    return (
      <div key={item.key} className={styles["task-entry"]}>
        <TaskCard
          action={item.action}
          request={entry.request}
          createdAt={item.createdAt}
          title={isQuestion ? item.answer : undefined}
          meta={isQuestion ? `요청 : ${entry.request}` : status.label}
        >
          {renderDetail(entry)}
        </TaskCard>
        {status.group === "approval" && onSaveRequestAsSkill && (
          <div className={styles["task-actions"]}>
            <button type="button" className={cx(styles["task-pill"], styles["is-primary"])} onClick={() => onSaveRequestAsSkill(entry.request)}>
              <AgentAssetIcon src={taskBoltIcon} size={12} />
              이 요청을 스킬로 저장
            </button>
          </div>
        )}
      </div>
    );
  }

  const hasClarifySection = sections.some((section) => section.group === "clarify");
  // "선택 필요" 묶음이 없으면 스킬 대상 카드만 담은 묶음을 묶음 순서(TASK_GROUPS)대로 끼운다. -1이면 맨 뒤.
  const clarifyOrder = TASK_GROUPS.findIndex(({ group }) => group === "clarify");
  const standaloneSkillTargetIndex = skillTarget && !hasClarifySection
    ? sections.findIndex((section) => TASK_GROUPS.findIndex(({ group }) => group === section.group) > clarifyOrder)
    : null;
  const standaloneSkillTarget = skillTarget && !hasClarifySection ? (
    <section className={styles["task-section"]} aria-label="선택 필요">
      <p className={styles["task-section-label"]}>선택 필요</p>
      <SkillTargetTaskCard target={skillTarget} />
    </section>
  ) : null;
  const isEmpty = sections.length === 0 && !pendingTask && !(activePreview && !hasPreviewEntry) && !skillTarget;
  return (
    <div className={styles["task-body"]} ref={bodyRef}>
      {isEmpty && (
        <div className={styles["task-empty"]}>
          <p>문서 편집·폴더 정리·스킬 실행을 요청해 보세요.</p>
          <p>/를 입력하면 스킬을 고를 수 있어요. 위키 내용 질문은 채팅 탭에서 할 수 있어요.</p>
        </div>
      )}
      {sections.map((section, index) => (
        <Fragment key={section.group}>
          {index === standaloneSkillTargetIndex && standaloneSkillTarget}
          <section className={styles["task-section"]} aria-label={section.label}>
            <p className={styles["task-section-label"]}>{section.label}</p>
            {section.group === "done" ? (
              <>
                <div className={styles["task-rows"]}>
                  {section.entries.map((entry) => <TaskRow key={entry.item.key} title={entry.title} status={entry.status} />)}
                </div>
                <TaskNote>{DONE_NOTICE}</TaskNote>
              </>
            ) : section.entries.map(renderCard)}
            {section.group === "clarify" && skillTarget && <SkillTargetTaskCard target={skillTarget} />}
          </section>
        </Fragment>
      ))}
      {standaloneSkillTargetIndex === -1 && standaloneSkillTarget}
      {/* 서버 기록에 붙기 전의 편집안(응답 직후 목록을 다시 받는 사이)도 놓치지 않는다. */}
      {activePreview && !hasPreviewEntry && (
        <section className={styles["task-section"]} aria-label="확인 필요">
          <p className={styles["task-section-label"]}>확인 필요</p>
          {activePreview}
        </section>
      )}
      {pendingTask && (
        <section className={styles["task-section"]} aria-label="진행 중" aria-live="polite">
          <p className={styles["task-section-label"]}>진행 중</p>
          <TaskCard action={null} request={pendingTask.request} createdAt={null}>
            <StatusList
              title="요청 처리 중"
              isLoading
              hasResponse={false}
              steps={pendingTask.stages.length ? buildProgressSteps(pendingTask.stages, true) : [["요청을 전달하고 있어요.", "active"]]}
            />
          </TaskCard>
        </section>
      )}
      {errorMessage && <p className={styles["query-error"]} role="alert">{errorMessage}</p>}
    </div>
  );
}
