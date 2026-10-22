"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUserPreferences } from "@/entities/user";
import { isNotificationControlEnabled } from "@/entities/user/model/preferences";
import type { DocumentItemResponse } from "@/entities/document";
import { createClientId, type DocumentStatus } from "@/entities/tree";
import { isDocumentInFlight, isDocumentPipelineActive } from "@/entities/document/lib/documentKind";
import { usePageVisible } from "@/shared/hooks/usePageVisible";
import { buildFailedDocumentsNotice } from "./failedDocumentsNotice";
import { hasFinishedSince, latestProcessedAt } from "./finishedWhilePaused";
import { publishNotice, setVisibleNoticeSubjects, subscribeNotices, type NoticePayload } from "./noticeBus";
import { enqueueNotice, promoteParkedNotices, reconcileNotices, selectAutoDismissIds, visibleNoticeSubjectIds } from "./noticeQueue";
import { createOperationNoticeFilter } from "./operationNoticeFilter";
import { isNoticeEnabled } from "./noticePreference";

type DocumentProcessingNotice = NoticePayload & { id: string; leaving?: boolean; parked?: boolean; shownAt?: number };

const NOTICE_DURATION_MS = 6000;
const MAX_VISIBLE_NOTICES = 2;
/** CSS notice-leave 애니메이션 길이와 맞춘다. */
const NOTICE_EXIT_MS = 200;

/** 카드가 닫히거나 내려가 자리가 나면 대기열의 카드를 다시 보인다. */
function promote(notices: DocumentProcessingNotice[]) {
  return promoteParkedNotices(notices, { max: MAX_VISIBLE_NOTICES, now: Date.now() });
}

function wasProcessing(status: DocumentStatus | undefined) {
  return isDocumentInFlight(status);
}

function completedNoticeText(count: number) {
  return {
    title: "문서 처리 완료",
    message: count === 1 ? "위키 편입이 완료되었습니다." : `${count}개 문서의 위키 편입이 완료되었습니다.`
  };
}

/**
 * isPaused: 스택을 잠시 화면에서 뺀 동안(좁은 화면에서 겹친 채팅 패널·사이드바가 열림) 카드를 쌓아 두기만 하고
 * 자동 닫힘 타이머를 멈춘다. 다시 보이면 남은 일반 카드에 타이머를 새로 건다.
 */
export function useDocumentProcessingNotifications(documents: DocumentItemResponse[], isPaused = false) {
  const { preferences, reduceMotion } = useUserPreferences();
  const notificationSettings = preferences.notifications;
  const notificationControls = preferences.notificationControls;
  const browserNotifications = notificationSettings.browser && isNotificationControlEnabled("browser", notificationControls);
  const [notices, setNotices] = useState<DocumentProcessingNotice[]>([]);
  const previousStatusesRef = useRef<Map<string, DocumentStatus> | null>(null);
  // documents 폴링이 멈춘(숨김 + 처리 중 문서 없음) 시점의 processed_at 기준점. 다음 갱신 1회에 소비한다.
  const pausedBaselineRef = useRef<number | null>(null);
  const isPageVisible = usePageVisible();
  // 카드 id별 자동 닫힘 타이머와 퇴장 후 제거 타이머
  const autoDismissTimersRef = useRef(new Map<string, number>());
  const exitTimersRef = useRef(new Map<string, number>());
  const operationFilterRef = useRef(createOperationNoticeFilter());

  // 닫기는 퇴장 표시(leaving) → NOTICE_EXIT_MS 뒤 제거 두 단계다. reduce-motion이면 바로 제거한다.
  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => promote(
      reduceMotion
        ? current.filter((notice) => notice.id !== id)
        : current.map((notice) => (notice.id === id ? { ...notice, leaving: true } : notice))
    ));
  }, [reduceMotion]);

  // 카드 표시 + 백그라운드 탭이면 브라우저 알림까지. 모든 알림이 이 경로를 지난다.
  const pushNotice = useCallback((notice: NoticePayload) => {
    if (!isNoticeEnabled(notice, notificationSettings, notificationControls)) return;
    // 설정 확인은 위에서 공통 처리하고, 작업 id 중복만 거른다.
    if (!operationFilterRef.current(notice, { lint: true, restore: true })) return;
    const id = createClientId(notice.kind);
    setNotices((current) => enqueueNotice(current, { id, ...notice }, {
      max: MAX_VISIBLE_NOTICES,
      now: Date.now(),
      removeImmediately: reduceMotion
    }));
    // 자동 닫힘 타이머는 아래 effect가 건다(액션 카드는 사용자가 선택할 때까지 남긴다).

    if (
      browserNotifications
      && document.visibilityState === "hidden"
      && "Notification" in window
      && Notification.permission === "granted"
    ) {
      new Notification(notice.title, { body: notice.message });
    }
  }, [browserNotifications, notificationControls, notificationSettings, reduceMotion]);

  // 설정을 끄면 현재 보이는 카드와 대기열 모두에서 해당 종류를 제거한다.
  useEffect(() => {
    setNotices((current) => promote(current.filter((notice) => isNoticeEnabled(notice, notificationSettings, notificationControls))));
  }, [notificationControls, notificationSettings]);

  // 대기 작업 감지(usePendingWorkNotifications)가 보이는 카드와 같은 문서로 제안을 겹쳐 띄우지 않도록 알린다.
  useEffect(() => {
    setVisibleNoticeSubjects(visibleNoticeSubjectIds(notices));
  }, [notices]);
  useEffect(() => () => setVisibleNoticeSubjects(new Set()), []);

  // 문서가 삭제·이름 변경·편입 시작되면 제안 카드의 대상과 문구를 최신 목록에 맞추고, 다룰 문서가 없으면 내린다.
  useEffect(() => {
    setNotices((current) => promote(reconcileNotices(
      current,
      (notice) => (notice.reconcile ? notice.reconcile(documents) : undefined),
      { removeImmediately: reduceMotion }
    )));
  }, [documents, reduceMotion]);

  // 닫혔거나 퇴장 중인 카드의 자동 닫힘 타이머를 해제하고, 퇴장 중인 카드는 애니메이션 뒤 제거한다.
  useEffect(() => {
    const byId = new Map(notices.map((notice) => [notice.id, notice]));
    const autoTimers = autoDismissTimersRef.current;
    const exitTimers = exitTimersRef.current;
    autoTimers.forEach((timer, id) => {
      const notice = byId.get(id);
      // 대기열로 빠진 카드는 다시 보일 때 타이머를 새로 건다.
      if (notice && !notice.leaving && !notice.parked) return;
      window.clearTimeout(timer);
      autoTimers.delete(id);
    });
    exitTimers.forEach((_, id) => {
      if (!byId.has(id)) exitTimers.delete(id);
    });
    notices.forEach((notice) => {
      if (!notice.leaving || exitTimers.has(notice.id)) return;
      exitTimers.set(notice.id, window.setTimeout(() => {
        exitTimers.delete(notice.id);
        setNotices((current) => promote(current.filter((item) => item.id !== notice.id)));
      }, NOTICE_EXIT_MS));
    });
  }, [notices]);

  // 보이는 동안 타이머가 없는 일반 카드에 자동 닫힘 타이머를 건다. 숨긴 동안에는 모두 멈춰 카드가 보이지 않은 채 사라지지 않게 한다.
  useEffect(() => {
    const autoTimers = autoDismissTimersRef.current;
    if (isPaused) {
      autoTimers.forEach((timer) => window.clearTimeout(timer));
      autoTimers.clear();
      return;
    }
    selectAutoDismissIds(notices, new Set(autoTimers.keys())).forEach((id) => {
      autoTimers.set(id, window.setTimeout(() => dismissNotice(id), NOTICE_DURATION_MS));
    });
  }, [dismissNotice, isPaused, notices]);

  useEffect(() => {
    const autoTimers = autoDismissTimersRef.current;
    const exitTimers = exitTimersRef.current;
    return () => {
      autoTimers.forEach((timer) => window.clearTimeout(timer));
      exitTimers.forEach((timer) => window.clearTimeout(timer));
      autoTimers.clear();
      exitTimers.clear();
    };
  }, []);

  // 다른 feature(질의·AI 작업)가 버스로 발행한 알림을 같은 스택에 표시한다.
  useEffect(() => subscribeNotices(pushNotice), [pushNotice]);

  useEffect(() => {
    const currentStatuses = new Map(documents.map((document) => [document.id, document.status]));
    const previousStatuses = previousStatusesRef.current;
    previousStatusesRef.current = currentStatuses;
    const pausedBaseline = pausedBaselineRef.current;
    pausedBaselineRef.current = null;
    if (!previousStatuses) return;

    let completedCount = 0;
    let convertedCount = 0;
    const failedDocuments: DocumentItemResponse[] = [];
    documents.forEach((document) => {
      const previousStatus = previousStatuses.get(document.id);
      // 처리 중이었다가 종결됐거나, 폴링이 멈춘 동안 시작·종결돼 처리 중 상태를 보지 못한 문서
      const finishedWhilePaused = pausedBaseline !== null && hasFinishedSince(document, pausedBaseline);
      if (!wasProcessing(previousStatus) && !finishedWhilePaused) return;
      if (document.status === "completed") {
        if (document.pipeline_run_id?.startsWith("convert:")) convertedCount += 1;
        else completedCount += 1;
      }
      if (document.status === "failed") failedDocuments.push(document);
    });

    if (completedCount > 0) {
      publishNotice({ kind: "completed", ...completedNoticeText(completedCount) });
    }
    if (convertedCount > 0) {
      publishNotice({ kind: "completed", title: "PDF 변환 완료", message: `${convertedCount}개 PDF의 Markdown 변환이 완료되었습니다.` });
    }
    // 문서별 카드 대신 요약 카드 하나만 발행한다 (대량 실패 시 스택 넘침 방지).
    if (failedDocuments.length > 0) {
      publishNotice(buildFailedDocumentsNotice(failedDocuments));
    }
  }, [documents]);

  // 위 effect가 이전 기준점을 소비한 뒤에 다시 기록하도록 뒤에 둔다.
  // 처리 완료 문서가 하나도 없으면(첫 로드 전 빈 목록 포함) 기준점을 두지 않아 전체 문서가 알림으로 뜨지 않게 한다.
  useEffect(() => {
    if (isPageVisible || documents.some(isDocumentPipelineActive)) return;
    pausedBaselineRef.current = latestProcessedAt(documents);
  }, [documents, isPageVisible]);

  return { notices, dismissNotice };
}
