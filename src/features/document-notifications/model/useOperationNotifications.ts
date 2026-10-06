"use client";

import { useEffect, useRef } from "react";
import { fetchOperationLogs, OPERATION_TYPE_LABELS, type OperationLogItem, type OperationStatus } from "@/entities/operation-log";
import { useUserPreferences } from "@/entities/user";
import { publishNotice } from "./noticeBus";
import { nextOperationPollDelay } from "./operationPolling";

const TERMINAL_STATUSES = new Set(["succeeded", "partially_succeeded", "failed", "conflict"]);
// 목록 조회는 status를 비우면 진행 중 로그를 숨기므로, 진행 중 상태를 따로 조회해 합친다.
// lint는 processing만 거치고 restore는 applying → rebuilding(→ notify_pending)을 거친다.
const ACTIVE_QUERIES: { type: "lint" | "restore"; status: OperationStatus }[] = [
  { type: "lint", status: "processing" },
  { type: "restore", status: "applying" },
  { type: "restore", status: "rebuilding" },
  { type: "restore", status: "notify_pending" }
];

// ingest는 문서 처리 알림이 담당하고, document_edit은 채팅 화면에서 즉시 확인되므로 제외한다.
const WATCHED_TYPES: Record<string, string> = {
  lint: OPERATION_TYPE_LABELS.lint,
  restore: OPERATION_TYPE_LABELS.restore
};

function isTerminal(status: string) {
  return TERMINAL_STATUSES.has(status);
}

function noticeFor(item: OperationLogItem) {
  const label = WATCHED_TYPES[item.operation_type];
  const isFailed = item.status === "failed" || item.status === "conflict";
  return {
    kind: isFailed ? ("failed" as const) : ("completed" as const),
    title: `${label} ${isFailed ? "실패" : "완료"}`,
    message: item.summary || `${label} 작업이 ${isFailed ? "실패했습니다." : "완료되었습니다."}`
  };
}

/**
 * 오래 걸리는 AI 작업(lint·restore)의 종결을 감지해 알림을 발행한다.
 * ai-operation-logs 목록을 폴링하며, 진행 중 → 종결 전이와
 * 폴링 사이에 새로 나타난 종결 작업을 모두 잡는다. 유형별로 켜고 끌 수 있다.
 */
export function useOperationNotifications() {
  const { preferences } = useUserPreferences();
  const { lint: lintEnabled, restore: restoreEnabled } = preferences.notifications;
  const enabled = lintEnabled || restoreEnabled;
  const knownStatusesRef = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer = 0;
    // 숨김 탭에서 예약을 건너뛴 상태. 다시 보이면 즉시 한 번 폴링한다.
    let paused = false;

    async function poll() {
      let logs: OperationLogItem[];
      try {
        const [terminal, ...active] = await Promise.all([
          fetchOperationLogs(),
          ...ACTIVE_QUERIES.map((query) => fetchOperationLogs({ ...query, size: 10 }))
        ]);
        logs = [...terminal.logs, ...active.flatMap((page) => page.logs)];
      } catch {
        // 워크스페이스 미선택·일시적 실패는 다음 폴링에서 재시도한다.
        schedule(false);
        return;
      }
      if (cancelled) return;

      const previous = knownStatusesRef.current;
      const next = new Map(logs.map((log) => [log.operation_id, log.status]));

      if (previous) {
        for (const log of logs) {
          const typeEnabled = log.operation_type === "lint" ? lintEnabled
            : log.operation_type === "restore" ? restoreEnabled
            : false;
          if (!typeEnabled || !isTerminal(log.status)) continue;
          const previousStatus = previous.get(log.operation_id);
          // 진행 중이었다가 종결됐거나, 폴링 사이에 새로 나타나 이미 종결된 작업
          if (!previousStatus || !isTerminal(previousStatus)) {
            publishNotice(noticeFor(log));
          }
        }
      }
      knownStatusesRef.current = next;
      const hasActive = logs.some((log) => !isTerminal(log.status));
      schedule(hasActive);
    }

    // 숨김 전에 예약된 타이머는 숨김 뒤에도 한 번 더 실행된다. 보이는 상태에서 방금 시작한 lint·restore를
    // 이 폴링이 잡으면 hasActive로 3초 폴링이 이어지므로 의도한 동작이다. 멈춤은 그다음 schedule에서 판단한다.
    function schedule(hasActive: boolean) {
      if (cancelled) return;
      const delay = nextOperationPollDelay(hasActive, document.visibilityState === "hidden");
      if (delay === null) {
        paused = true;
        return;
      }
      timer = window.setTimeout(() => void poll(), delay);
    }

    function resumeWhenVisible() {
      if (!paused || document.visibilityState === "hidden") return;
      paused = false;
      window.clearTimeout(timer);
      void poll();
    }

    document.addEventListener("visibilitychange", resumeWhenVisible);
    void poll();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      window.clearTimeout(timer);
    };
  }, [enabled, lintEnabled, restoreEnabled]);
}
