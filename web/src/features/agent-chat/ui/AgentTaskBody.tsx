import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import taskBoltIcon from "@/shared/assets/svg/agent/task-bolt.svg";
import taskBoltDangerIcon from "@/shared/assets/svg/agent/task-bolt-danger.svg";
import { getWorkspaceId } from "@/shared/api/client";
import type { RunStageEvent } from "@/shared/lib/runEventStream";
import { cx } from "@/shared/lib/classNames";
import { fetchAgentPlanRun } from "../api/agentPlan";
import { isPlanRunSettled, isWorkspacePlanAction, shouldPollAgentPlan, type AgentPlanRun } from "../lib/agentPlan";
import { buildProgressSteps } from "../lib/progressSteps";
import { groupTaskEntries, resolveTaskStatus, taskKindLabel, type TaskMessageItem, type TaskStatusView } from "../lib/taskThread";
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

function TaskNote({ children, role }: { children: ReactNode; role?: "alert" | "status" }) {
  return <p className={styles["task-note"]} role={role}>{children}</p>;
}

/**
 * 작업 탭 본문(Figma 1610:9529): 상태별 묶음(진행 중·승인 대기·추가 설명 필요·실패·완료)마다
 * 작업 줄과 미리보기·승인 버튼·안내를 보여 준다. 폴더 정리 계획은 turn→run을 따라가 상태를 받는다.
 */
export function AgentTaskBody({
  items,
  pendingTask,
  activePreviewTurnId,
  activePreview,
  appliedTurnIds,
  errorMessage,
  isShown
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

  // 실행이 끝나는 전이를 볼 때만 문서·트리·그래프를 다시 받는다(#66).
  const runStatusSignature = runQueries.map((query) => query.data?.status ?? "").join("|");
  const previousStatuses = useRef<string[]>([]);
  useEffect(() => {
    const statuses = runStatusSignature.split("|");
    const settled = statuses.some((status, index) => isPlanRunSettled(previousStatuses.current[index] || undefined, status || undefined));
    if (settled) void client.invalidateQueries({ queryKey: ["backendData"] });
    previousStatuses.current = statuses;
  }, [client, runStatusSignature]);

  const entries: TaskEntry[] = items.map((item) => {
    const query = runsByKey.get(item.key);
    const run = query?.data ?? null;
    const status = resolveTaskStatus({
      action: item.action,
      messageStatus: item.messageStatus,
      runStatus: run?.status,
      operationCount: run?.plan?.operations.length ?? 0,
      hasActivePreview: Boolean(activePreview) && item.turnId !== null && item.turnId === activePreviewTurnId,
      isApplied: item.turnId !== null && appliedTurnIds.has(item.turnId)
    });
    const request = run?.request_summary?.trim().normalize("NFC") || item.request || "요청 내용 없음";
    return {
      item,
      status,
      title: `${taskKindLabel(item.action)} : ${request}`,
      run,
      runError: query?.error ?? null,
      isRunFetching: query?.isFetching ?? false,
      refetchRun: () => { void query?.refetch(); }
    };
  });
  const sections = groupTaskEntries(entries);
  const hasPreviewEntry = entries.some((entry) => entry.status.group === "approval" && entry.item.turnId === activePreviewTurnId);

  // 새 작업·미리보기가 생기면 목록 아래(입력창 쪽)로 내린다.
  const lastKey = `${items.at(-1)?.key ?? ""}|${pendingTask ? "pending" : ""}|${activePreviewTurnId ?? ""}`;
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
        />
      );
    }
    if (status.group === "approval" && item.turnId === activePreviewTurnId) return activePreview;
    if ((status.group === "clarify" || status.group === "failed") && item.answer) {
      return <TaskNote role={status.group === "failed" ? "alert" : undefined}>{item.answer}</TaskNote>;
    }
    return null;
  }

  const isEmpty = sections.length === 0 && !pendingTask && !(activePreview && !hasPreviewEntry);
  return (
    <div className={styles["task-body"]} ref={bodyRef}>
      {isEmpty && (
        <div className={styles["task-empty"]}>
          <p>문서 편집·폴더 정리·스킬 실행을 요청해 보세요.</p>
          <p>/를 입력하면 스킬을 고를 수 있어요. 위키 내용 질문은 채팅 탭에서 할 수 있어요.</p>
        </div>
      )}
      {sections.map((section) => (
        <section key={section.group} className={styles["task-section"]} aria-label={section.label}>
          <p className={styles["task-section-label"]}>{section.label}</p>
          {section.group === "done" ? (
            <>
              <div className={styles["task-rows"]}>
                {section.entries.map((entry) => <TaskRow key={entry.item.key} title={entry.title} status={entry.status} />)}
              </div>
              <TaskNote>{DONE_NOTICE}</TaskNote>
            </>
          ) : section.entries.map((entry) => (
            <div key={entry.item.key} className={styles["task-entry"]}>
              <TaskRow title={entry.title} status={entry.status} />
              {renderDetail(entry)}
            </div>
          ))}
        </section>
      ))}
      {/* 서버 기록에 붙기 전의 편집안(응답 직후 목록을 다시 받는 사이)도 놓치지 않는다. */}
      {activePreview && !hasPreviewEntry && (
        <section className={styles["task-section"]} aria-label="승인 대기">
          <p className={styles["task-section-label"]}>승인 대기</p>
          {activePreview}
        </section>
      )}
      {pendingTask && (
        <section className={styles["task-section"]} aria-label="진행 중" aria-live="polite">
          <p className={styles["task-section-label"]}>진행 중</p>
          <div className={styles["task-entry"]}>
            <TaskRow title={`작업 : ${pendingTask.request}`} status={{ group: "running", label: "진행 중", tone: "primary", struck: false }} />
            <StatusList
              title="요청 처리 중"
              isLoading
              hasResponse={false}
              steps={pendingTask.stages.length ? buildProgressSteps(pendingTask.stages, true) : [["요청을 전달하고 있어요.", "active"]]}
            />
          </div>
        </section>
      )}
      {errorMessage && <p className={styles["query-error"]} role="alert">{errorMessage}</p>}
    </div>
  );
}
