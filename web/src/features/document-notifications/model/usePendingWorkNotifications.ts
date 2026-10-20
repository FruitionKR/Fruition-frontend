"use client";

import { useEffect, useRef } from "react";
import { useUserPreferences } from "@/entities/user";
import { reflectDocumentToWiki } from "@/entities/document";
import type { DocumentItemResponse } from "@/entities/document";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { fetchWikiMaintenanceStatus, requestWikiLint } from "../api/wikiLint";
import { hasBeenIngestedToWiki, ingestPromptMessage, isAwaitingFirstIngest, selectIngestPromptTargets } from "./ingestPromptTargets";
import { isNoticeSubjectVisible, noticeSubjectHiddenAt, publishNotice } from "./noticeBus";

// 연속 업로드를 한 장의 카드로 묶기 위한 대기 시간
const INGEST_PROMPT_DEBOUNCE_MS = 3_000;
// 첫 편입 대기(uploaded·편입 전 새 노트) 상태로 이 시간 이상 머물면 리마인드 카드를 띄운다.
// 같은 문서의 카드가 사라진 뒤에도 이만큼 지나야 리마인드한다(카드가 내려가자마자 다시 뜨지 않게).
const INGEST_STALL_MS = 60_000;
const STALL_CHECK_INTERVAL_MS = 30_000;
// 연속 완료 시 같은 제안 카드가 반복되지 않게 최소 간격을 둔다.
const LINT_CHECK_COOLDOWN_MS = 5 * 60_000;
// 새로고침해도 이미 보여준 제안 카드가 반복되지 않도록 제안 기록을 워크스페이스별로 보존한다.
const PROMPT_MEMORY_STORAGE_PREFIX = "fruition.pending_work_prompted";
// 워크스페이스 구분 없이 쌓던 예전 키. 어느 워크스페이스 기록인지 알 수 없어 읽지 않고 지운다.
const LEGACY_PROMPT_MEMORY_STORAGE_KEY = PROMPT_MEMORY_STORAGE_PREFIX;

type PromptMemory = { prompted?: string[]; stalled?: string[]; reingest?: string[] };

/** 워크스페이스의 제안 기록 키. 워크스페이스를 모르면 null(이번 화면에서만 기억한다). */
export function promptMemoryStorageKey(workspaceId: string | null | undefined): string | null {
  return workspaceId ? `${PROMPT_MEMORY_STORAGE_PREFIX}.${workspaceId}` : null;
}

/** 저장된 기록과 그 원문. 원문은 바뀌지 않은 기록을 다시 쓰지 않으려고 비교에 쓴다. */
function loadPromptMemory(key: string | null): { memory: PromptMemory; raw: string | null } {
  if (typeof window === "undefined" || !key) return { memory: {}, raw: null };
  try {
    window.localStorage.removeItem(LEGACY_PROMPT_MEMORY_STORAGE_KEY);
    const raw = window.localStorage.getItem(key);
    return { memory: (JSON.parse(raw ?? "null") ?? {}) as PromptMemory, raw };
  } catch {
    // 손상된 저장값은 무시하고 새로 쌓는다.
    return { memory: {}, raw: null };
  }
}

function savePromptMemory(key: string | null, serialized: string) {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.setItem(key, serialized);
  } catch {
    // 저장 실패는 다음 새로고침에 카드가 한 번 더 보일 뿐이므로 무시한다.
  }
}

type PromptHandlers = {
  /** 버튼을 누른 시점의 최신 문서 목록 */
  getDocuments: () => DocumentItemResponse[];
  /** 하나라도 편입 요청이 접수되면 부른다. 문서 목록을 바로 다시 받아 진행 상태(빠른 폴링)를 놓치지 않게 한다. */
  onStarted: () => void;
};

/**
 * 위키 편입 제안 카드. 발행 뒤 문서가 삭제·이름 변경·편입 시작되면 스택이 reconcile로 대상과 문구를 맞추고,
 * 버튼을 누르면 그 시점의 최신 목록(getDocuments)으로 다시 골라 없어진 문서·이미 편입 중인 문서는 건너뛴다.
 */
function publishIngestPrompt(
  candidates: DocumentItemResponse[],
  title: string,
  enabled: boolean,
  { getDocuments, onStarted }: PromptHandlers
) {
  if (!enabled) return;
  // PDF 원본은 ingest 대상이 아니므로 분석 제안에서 제외한다.
  const documents = selectIngestPromptTargets(candidates.map((document) => document.id), candidates);
  if (documents.length === 0) return;
  const ids = documents.map((document) => document.id);
  publishNotice({
    kind: "info",
    title,
    message: ingestPromptMessage(documents),
    subjectIds: ids,
    requiredPermission: "wiki.ingest",
    reconcile: (latest) => {
      const targets = selectIngestPromptTargets(ids, latest);
      if (targets.length === 0) return null;
      return { message: ingestPromptMessage(targets), subjectIds: targets.map((document) => document.id) };
    },
    action: {
      label: "위키 편입",
      onAction: () => {
        const targets = selectIngestPromptTargets(ids, getDocuments());
        if (targets.length === 0) return;
        void Promise.allSettled(
          targets.map((document) => reflectDocumentToWiki(document.id, document.document_role))
        ).then((results) => {
          if (results.some((result) => result.status === "fulfilled")) onStarted();
          // 실패 사유는 백엔드 원문을 그대로 보여준다. 개수만 알려주면 원인을 알 수 없다.
          const failures = results.flatMap((result, index) =>
            result.status === "rejected"
              ? [`${targets[index].filename}: ${getErrorMessage(result.reason, "요청에 실패했습니다.")}`]
              : []
          );
          if (failures.length > 0) {
            publishNotice({
              kind: "failed",
              title: "위키 편입 시작 실패",
              message: failures.join(" / ")
            });
          }
        });
      }
    }
  });
}

/**
 * 사용자 개입이 필요한 상황을 감지해 알림 카드를 발행한다.
 * - ingest 시작 제안: 업로드·새 노트 직후(연속 묶음) / 세션 진입 시 첫 편입 대기 문서 존재 / 60초 정체 리마인드
 *   첫 편입 대기 = uploaded 또는 편입한 적 없는 needs_reingest 문서(직접 만든 노트 등, isAwaitingFirstIngest)
 * - 재분석 제안: 편입한 적 있는 문서가 마지막 ingest 이후 편집됨(needs_reingest) 감지
 * - 위키 최신화(lint) 필요: ingest 완료 직후 유지보수 상태(needs_lint)를 확인
 * permissions: 위키 편입(wiki.ingest)·위키 최신화(wiki.lint) 권한. 없으면 해당 제안을 띄우지 않고, 확인 전(null)이면 기다린다.
 * workspaceId·isDocumentsLoaded: 워크스페이스를 바꾸면 기준(이미 본 문서)을 비우고, 새 워크스페이스의 문서 목록을 받은 뒤의
 * 첫 스냅샷을 세션 진입 스냅샷으로 본다(기존 문서를 "새 문서가 추가되었습니다"로 알리지 않는다).
 */
export function usePendingWorkNotifications(
  documents: DocumentItemResponse[],
  {
    canIngest,
    canLint,
    onIngestStarted,
    workspaceId,
    isDocumentsLoaded = true
  }: {
    canIngest: boolean | null;
    canLint: boolean | null;
    onIngestStarted?: () => void;
    /** 지금 문서 목록의 워크스페이스. 바뀌면 기준을 다시 잡는다. */
    workspaceId?: string | null;
    /** 이 워크스페이스의 문서 목록을 한 번이라도 받았는지. 받기 전(빈 목록)은 첫 스냅샷으로 삼지 않는다. */
    isDocumentsLoaded?: boolean;
  }
) {
  const { preferences } = useUserPreferences();
  const suggestEnabled = preferences.notifications.suggest;
  const suggestEnabledRef = useRef(suggestEnabled);
  suggestEnabledRef.current = suggestEnabled;
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const onIngestStartedRef = useRef(onIngestStarted);
  onIngestStartedRef.current = onIngestStarted;
  // 제안 카드 버튼은 누르는 시점의 최신 목록으로 대상을 다시 고르고, 요청이 접수되면 목록을 다시 받게 한다.
  const promptHandlers: PromptHandlers = {
    getDocuments: () => documentsRef.current,
    onStarted: () => onIngestStartedRef.current?.()
  };
  const knownIdsRef = useRef<Set<string> | null>(null);
  const promptedIdsRef = useRef(new Set<string>());
  const promptQueueRef = useRef(new Set<string>());
  const promptTimerRef = useRef<number | null>(null);
  const uploadedFirstSeenRef = useRef(new Map<string, number>());
  const stallNotifiedRef = useRef(new Set<string>());
  const previousStatusesRef = useRef<Map<string, string> | null>(null);
  const reingestNotifiedRef = useRef(new Set<string>());
  const lintCheckInFlightRef = useRef(false);
  const lastLintCheckAtRef = useRef(0);
  // 새로고침 후에도 같은 카드를 다시 띄우지 않도록 제안 기록을 localStorage에서 복원한다.
  const promptMemoryLoadedRef = useRef(false);
  // 마지막으로 읽거나 쓴 기록 원문. 같으면 다시 쓰지 않는다(문서 목록 갱신·30초 점검마다 쓰지 않게).
  const persistedMemoryRef = useRef<string | null>(null);
  const baselineWorkspaceRef = useRef(workspaceId);

  /** 워크스페이스가 바뀌었으면 이전 워크스페이스의 기준·대기열을 버린다. 각 effect 앞에서 부르며 여러 번 불러도 같다. */
  function syncWorkspaceBaseline() {
    if (baselineWorkspaceRef.current === workspaceId) return;
    baselineWorkspaceRef.current = workspaceId;
    knownIdsRef.current = null;
    previousStatusesRef.current = null;
    uploadedFirstSeenRef.current.clear();
    promptQueueRef.current = new Set();
    // 제안 기록도 워크스페이스별이라 새 워크스페이스의 기록을 다시 읽는다.
    promptMemoryLoadedRef.current = false;
    persistedMemoryRef.current = null;
    promptedIdsRef.current.clear();
    stallNotifiedRef.current.clear();
    reingestNotifiedRef.current.clear();
    if (promptTimerRef.current) {
      window.clearTimeout(promptTimerRef.current);
      promptTimerRef.current = null;
    }
  }

  function restorePromptMemory() {
    if (promptMemoryLoadedRef.current) return;
    promptMemoryLoadedRef.current = true;
    const { memory, raw } = loadPromptMemory(promptMemoryStorageKey(baselineWorkspaceRef.current));
    persistedMemoryRef.current = raw;
    memory.prompted?.forEach((id) => promptedIdsRef.current.add(id));
    memory.stalled?.forEach((id) => stallNotifiedRef.current.add(id));
    memory.reingest?.forEach((id) => reingestNotifiedRef.current.add(id));
  }

  function persistPromptMemory() {
    const serialized = JSON.stringify({
      prompted: [...promptedIdsRef.current],
      stalled: [...stallNotifiedRef.current],
      reingest: [...reingestNotifiedRef.current]
    });
    if (serialized === persistedMemoryRef.current) return;
    persistedMemoryRef.current = serialized;
    savePromptMemory(promptMemoryStorageKey(baselineWorkspaceRef.current), serialized);
  }

  // ① 업로드·새 노트 직후 / ② 세션 진입 시: 첫 편입 대기 문서에 편입 시작 제안
  useEffect(() => {
    syncWorkspaceBaseline();
    // 권한을 확인하기 전·문서 목록을 받기 전에는 첫 스냅샷으로 삼지 않는다. 권한이 없으면 제안하지 않는다.
    if (canIngest !== true || !isDocumentsLoaded) return;
    restorePromptMemory();
    const known = knownIdsRef.current;
    const awaiting = documents.filter(isAwaitingFirstIngest);

    if (!known) {
      // 첫 스냅샷: 이미 대기 중인 문서가 있으면 즉시 제안 (세션 재진입 케이스)
      knownIdsRef.current = new Set(documents.map((document) => document.id));
      const initial = awaiting.filter((document) => !promptedIdsRef.current.has(document.id));
      initial.forEach((document) => promptedIdsRef.current.add(document.id));
      persistPromptMemory();
      publishIngestPrompt(initial, "위키 편입 대기 중인 문서가 있습니다", suggestEnabledRef.current, promptHandlers);
      return;
    }

    // 이후: 새로 등장한 첫 편입 대기 문서를 디바운스로 묶어 제안 (연속 업로드 대응)
    const fresh = awaiting.filter(
      (document) => !known.has(document.id) && !promptedIdsRef.current.has(document.id)
    );
    documents.forEach((document) => known.add(document.id));
    if (fresh.length > 0) {
      fresh.forEach((document) => {
        promptedIdsRef.current.add(document.id);
        promptQueueRef.current.add(document.id);
      });
      persistPromptMemory();
      if (promptTimerRef.current) window.clearTimeout(promptTimerRef.current);
      promptTimerRef.current = window.setTimeout(() => {
        promptTimerRef.current = null;
        const queuedIds = promptQueueRef.current;
        promptQueueRef.current = new Set();
        const targets = documentsRef.current.filter(
          (document) => queuedIds.has(document.id) && isAwaitingFirstIngest(document)
        );
        publishIngestPrompt(targets, "새 문서가 추가되었습니다", suggestEnabledRef.current, promptHandlers);
      }, INGEST_PROMPT_DEBOUNCE_MS);
    }
    // syncWorkspaceBaseline은 ref만 다룬다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, canIngest, workspaceId, isDocumentsLoaded]);

  useEffect(() => () => {
    if (promptTimerRef.current) window.clearTimeout(promptTimerRef.current);
  }, []);

  // ③ 60초 정체 리마인드: 제안을 넘겼거나 시작이 실패한 문서를 다시 잡아준다
  useEffect(() => {
    syncWorkspaceBaseline();
    if (canIngest !== true) return;
    restorePromptMemory();
    function checkStalledUploads() {
      const now = Date.now();
      const firstSeen = uploadedFirstSeenRef.current;
      const currentIds = new Set<string>();

      const stalled: DocumentItemResponse[] = [];
      documentsRef.current.forEach((document) => {
        if (!isAwaitingFirstIngest(document)) return;
        currentIds.add(document.id);
        const seenAt = firstSeen.get(document.id) ?? now;
        if (!firstSeen.has(document.id)) firstSeen.set(document.id, now);
        // 같은 문서의 제안 카드가 아직 화면(대기열 포함)에 있으면 리마인드하지 않는다.
        // 카드가 사라진 뒤에도 INGEST_STALL_MS가 지나야 다시 본다. 문서 목록이 바뀔 때마다 점검해도 카드가 곧바로 다시 뜨지 않는다.
        const quietSince = Math.max(seenAt, noticeSubjectHiddenAt(document.id) ?? Number.NEGATIVE_INFINITY);
        if (now - quietSince >= INGEST_STALL_MS && !stallNotifiedRef.current.has(document.id) && !isNoticeSubjectVisible(document.id)) {
          stalled.push(document);
          stallNotifiedRef.current.add(document.id);
        }
      });
      // 첫 편입 대기를 벗어난 문서는 추적에서 제거한다 (재업로드 시 다시 감지)
      [...firstSeen.keys()].forEach((id) => {
        if (!currentIds.has(id)) {
          firstSeen.delete(id);
          stallNotifiedRef.current.delete(id);
          promptedIdsRef.current.delete(id);
        }
      });
      persistPromptMemory();

      publishIngestPrompt(stalled, "위키 편입이 아직 시작되지 않았습니다", suggestEnabledRef.current, promptHandlers);
    }

    checkStalledUploads();
    const timer = window.setInterval(checkStalledUploads, STALL_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [documents, canIngest]);

  // 재분석 제안: 마지막 ingest 이후 편집된 문서(needs_reingest)를 감지한다.
  // 재분석이 시작되면 needs_reingest가 풀리므로, 그때 알림 기록을 해제해 다음 편집 때 다시 제안한다.
  useEffect(() => {
    syncWorkspaceBaseline();
    if (canIngest !== true) return;
    restorePromptMemory();
    // 문서 목록을 아직 받기 전(빈 배열)에는 복원한 알림 기록을 지우면 안 된다.
    // 여기서 지우면 목록 도착 시 같은 카드가 새로고침마다 다시 발행된다.
    if (documents.length === 0) return;
    // 편입한 적 없는 문서는 needs_reingest여도 "수정됨"이 아니다(새 문서 제안이 따로 다룬다).
    const needing = documents.filter((document) => document.needs_reingest && hasBeenIngestedToWiki(document));
    const needingIds = new Set(needing.map((document) => document.id));
    [...reingestNotifiedRef.current].forEach((id) => {
      if (!needingIds.has(id)) reingestNotifiedRef.current.delete(id);
    });

    const fresh = needing.filter((document) => !reingestNotifiedRef.current.has(document.id));
    if (fresh.length === 0) {
      persistPromptMemory();
      return;
    }
    fresh.forEach((document) => reingestNotifiedRef.current.add(document.id));
    persistPromptMemory();
    publishIngestPrompt(fresh, "마지막 위키 편입 이후 수정된 문서가 있습니다", suggestEnabledRef.current, promptHandlers);
  }, [documents, canIngest]);

  // 위키 최신화(lint) 필요 감지: 문서가 completed로 전이하면 유지보수 상태를 확인한다 (DB 비교라 저렴)
  useEffect(() => {
    syncWorkspaceBaseline();
    const currentStatuses = new Map(documents.map((document) => [document.id, document.status as string]));
    const previousStatuses = previousStatusesRef.current;
    previousStatusesRef.current = currentStatuses;
    if (!previousStatuses || !suggestEnabled || canLint !== true) return;

    const hasNewCompletion = documents.some((document) =>
      document.status === "completed" && previousStatuses.get(document.id) !== "completed"
      && previousStatuses.has(document.id)
    );
    if (!hasNewCompletion) return;
    if (lintCheckInFlightRef.current) return;
    if (Date.now() - lastLintCheckAtRef.current < LINT_CHECK_COOLDOWN_MS) return;

    lintCheckInFlightRef.current = true;
    lastLintCheckAtRef.current = Date.now();
    fetchWikiMaintenanceStatus()
      .then(({ needs_lint }) => {
        if (!needs_lint) return;
        publishNotice({
          kind: "info",
          title: "위키 최신화 제안",
          requiredPermission: "wiki.lint",
          message: "새 문서 반영 후 위키 페이지가 변경되었습니다. 위키 최신화를 실행할 수 있습니다.",
          action: {
            label: "위키 최신화",
            onAction: () => {
              requestWikiLint(false)
                .then(({ changedPageCount, operationId }) => {
                  publishNotice({
                    operation: { type: "lint", id: operationId },
                    kind: "completed",
                    title: "위키 최신화 완료",
                    message: `${changedPageCount}개 페이지를 다듬었습니다.`
                  });
                })
                .catch((error: unknown) => {
                  publishNotice({
                    kind: "failed",
                    title: "위키 최신화 실패",
                    message: getErrorMessage(error, "위키 최신화 요청에 실패했습니다.")
                  });
                });
            }
          }
        });
      })
      .catch(() => {
        // 상태 조회 실패는 제안을 못 띄울 뿐이므로 조용히 넘긴다. 다음 완료 시 재시도된다.
      })
      .finally(() => {
        lintCheckInFlightRef.current = false;
      });
  }, [canLint, documents, suggestEnabled]);
}
