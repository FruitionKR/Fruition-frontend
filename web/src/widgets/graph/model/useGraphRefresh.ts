import { useCallback, useEffect, useRef, useState } from "react";
import { publishNotice } from "@/features/document-notifications/model/noticeBus";

export type GraphRefreshStatus = "idle" | "loading" | "upToDate";

/** 바뀐 것이 없을 때 "최신 상태예요"를 보여 주는 시간 */
export const GRAPH_UP_TO_DATE_FEEDBACK_MS = 2_000;

export const GRAPH_REFRESH_ERROR_NOTICE = {
  title: "그래프 새로고침 실패",
  message: "그래프를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
};

/**
 * 그래프 새로고침 버튼 상태. 진행 중 반복 요청은 무시하고, 바뀐 것이 없으면 잠깐 upToDate를 보인다.
 * 실패하면 알림 카드로 알리고 지금 그래프는 그대로 둔다.
 */
export function useGraphRefresh(refresh: () => Promise<{ changed: boolean }>) {
  const [status, setStatus] = useState<GraphRefreshStatus>("idle");
  const isRefreshingRef = useRef(false);
  const feedbackTimerRef = useRef<number | null>(null);

  const clearFeedbackTimer = () => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
  };

  useEffect(() => clearFeedbackTimer, []);

  const run = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    clearFeedbackTimer();
    setStatus("loading");
    try {
      const { changed } = await refresh();
      if (changed) {
        setStatus("idle");
        return;
      }
      setStatus("upToDate");
      feedbackTimerRef.current = window.setTimeout(() => {
        feedbackTimerRef.current = null;
        setStatus("idle");
      }, GRAPH_UP_TO_DATE_FEEDBACK_MS);
    } catch {
      setStatus("idle");
      publishNotice({ kind: "failed", ...GRAPH_REFRESH_ERROR_NOTICE });
    } finally {
      isRefreshingRef.current = false;
    }
  }, [refresh]);

  return { status, refresh: run };
}
