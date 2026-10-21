import { useCallback, useState } from "react";
import { fetchQueryTaskStatus, requestQueryTaskCancel } from "@/entities/wiki/api/wiki";
import { publishNotice } from "@/features/document-notifications";
import {
  pendingQueryRuns,
  STALLED_QUERY_AGE_MS,
  stalledQueryCancelNotice,
  type StalledQueryCancelResult
} from "../lib/stalledTurns";
import { useStalledRuns } from "./useStalledAgentTurns";
import type { ChatMessageResponse } from "@/entities/chat/model/chat";

/** 닫기 취소 요청을 이만큼만 기다린다. 응답이 없어도 화면 잠금은 푼다. */
const CANCEL_REQUEST_TIMEOUT_MS = 10_000;
const NO_RUNS: ReadonlySet<string> = new Set();

async function requestCancel(runId: string): Promise<StalledQueryCancelResult> {
  try {
    return await requestQueryTaskCancel(runId, AbortSignal.timeout(CANCEL_REQUEST_TIMEOUT_MS));
  } catch {
    return { kind: "failed" };
  }
}

/**
 * pending에 오래 머문 채팅 질의(`query_` run)를 `GET ai/tasks/{id}`로 확인해 응답을 받지 못한 질의를 찾고,
 * '닫기'로 서버 취소(`POST ai/tasks/{id}/cancel`)를 요청한 뒤 입력 잠금을 푼다.
 * - 5분 넘게 pending인데 서버가 아직 끝나지 않았다고 하거나 task가 없으면(404) stalled
 * - 이 화면이 질의를 직접 따라가는 동안(isQueryActive)은 확인하지 않는다(Esc 취소가 따로 있다)
 * - 닫은 질의는 releaseRuns로 워크스페이스·세션별로 기억해 다시 잠기지 않는다
 */
export function useStalledQueries({
  messages,
  releasedRunIds,
  releaseRuns,
  isQueryActive,
  refreshMessages
}: {
  messages: ChatMessageResponse[];
  releasedRunIds: ReadonlySet<string>;
  releaseRuns: (runIds: readonly string[]) => void;
  isQueryActive: boolean;
  refreshMessages: () => Promise<unknown>;
}) {
  const stalledQueryIds = useStalledRuns({
    messages,
    selectPending: pendingQueryRuns,
    check: fetchQueryTaskStatus,
    thresholdMs: STALLED_QUERY_AGE_MS,
    ignoredRunIds: releasedRunIds,
    enabled: !isQueryActive,
    refreshMessages
  });
  const [closingQueryIds, setClosingQueryIds] = useState<ReadonlySet<string>>(NO_RUNS);

  /** 서버 취소를 먼저 요청하고, 결과와 상관없이 잠금을 푼다. 서버에 전하지 못했으면 알림으로 알린다. */
  const closeStalledQuery = useCallback(async (runId: string) => {
    setClosingQueryIds((current) => new Set([...current, runId]));
    const notice = stalledQueryCancelNotice(await requestCancel(runId));
    releaseRuns([runId]);
    setClosingQueryIds((current) => new Set([...current].filter((id) => id !== runId)));
    if (notice) publishNotice({ kind: "failed", title: "질문 취소 확인 실패", message: notice });
  }, [releaseRuns]);

  return { stalledQueryIds, closingQueryIds, closeStalledQuery };
}
