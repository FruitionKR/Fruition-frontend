"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchOperationLogDetail,
  fetchRestorePreview,
  filterOperationLogsByType,
  formatOperationLogDateTime,
  formatOperationLogDescription,
  formatOperationLogTitle,
  groupOperationLogsByDate,
  OPERATION_TYPE_LABELS,
  restoreOperation,
  type OperationChange,
  type OperationLogDetail,
  type OperationLogItem,
  type OperationType
} from "@/entities/operation-log";
import addIcon from "@/shared/assets/svg/log/diff-added.svg";
import deleteIcon from "@/shared/assets/svg/log/diff-removed.svg";
import { fetchMembers } from "@/entities/workspace/api/members";
import { publishNotice } from "@/features/document-notifications";
import { cx } from "@/shared/lib/classNames";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";
import { formatRelativeTime } from "@/shared/lib/relativeTime";
import { retryIcon, chevronDownSmallIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import styles from "./LogView.module.css";

const STATUS_LABELS: Record<string, string> = {
  processing: "처리 중",
  applying: "반영 중",
  notify_pending: "반영 중",
  rebuilding: "재조립 중",
  partially_succeeded: "일부 성공",
  failed: "실패",
  conflict: "충돌"
};

// diff가 없는 변경(삭제·복원 등)은 문구 대신 변경 종류만 보여준다. 값은 document-svc ChangeType.
const CHANGE_TYPE_LABELS: Record<string, string> = {
  created: "생성",
  updated: "수정",
  deleted: "삭제",
  restored: "복원",
  delegated: "재작성 위임",
  rebuilt: "재작성",
  rebuild_failed: "재작성 실패",
  action_failed: "작업 실패",
  link_removed: "링크 제거",
  link_restored: "링크 복원"
};

/** Wiki 본문 대신 유형별로 생성·삭제된 페이지 제목을 보여준다. */
function WikiTitles({ changes }: { changes: OperationChange[] }) {
  const groups = [
    { type: "concept", label: "Concept" },
    { type: "source", label: "Source" },
    { type: undefined, label: "유형 정보 없음" }
  ];
  return (
    <div className={styles["card-body"]}>
      {groups.map(({ type, label }) => {
        const pages = changes.filter((change) => change.page_type === type);
        if (pages.length === 0) return null;
        return (
          <section className={styles["change"]} key={label} aria-label={label}>
            <h4 className={styles["change-heading"]}>{label}</h4>
            <ul className={styles["wiki-titles"]}>
              {pages.map((page) => (
                <li key={page.id}>
                  {page.change_type === "created" ? "생성" : "삭제"} · {page.resource_display_name || "제목 없음"}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** 변경 리소스 하나의 diff를 Figma 754:10436 형태로 렌더링한다. */
function ChangeDiff({ change }: { change: OperationChange }) {
  const heading = change.resource_display_name
    || change.change_summary
    || `${change.resource_type} · ${change.change_type}`;

  return (
    <div className={styles["change"]}>
      <p className={styles["change-heading"]}>{heading}</p>
      {change.diff_too_large ? (
        <p className={styles["change-notice"]}>변경 폭이 커서 diff를 표시할 수 없습니다.</p>
      ) : !change.hunks?.length ? (
        <p className={styles["change-notice"]}>
          {change.additions != null || change.deletions != null
            ? `추가 ${change.additions ?? 0}줄 · 삭제 ${change.deletions ?? 0}줄`
            : CHANGE_TYPE_LABELS[change.change_type] ?? change.change_summary ?? "표시할 변경 내용이 없습니다."}
        </p>
      ) : (
        change.hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex} className={styles["hunk"]}>
            {hunk.lines.map((line, lineIndex) => (
              <div
                key={lineIndex}
                className={cx(
                  styles["diff-line"],
                  line.type === "ADD" && styles["is-add"],
                  line.type === "DELETE" && styles["is-delete"]
                )}
              >
                <span className={styles["diff-gutter"]}>
                  {line.type === "ADD" ? line.new_line : line.old_line ?? line.new_line ?? ""}
                </span>
                <span className={styles["diff-content"]}>
                  {line.type !== "CONTEXT" && (
                    <SvgIcon
                      src={line.type === "ADD" ? addIcon : deleteIcon}
                      className={styles["diff-icon"]}
                    />
                  )}
                  {line.content}
                </span>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/** 로그 화면 목록 상태. HomeWorkspace의 useOperationLogFeed 반환값을 그대로 받는다. */
type OperationLogFeedState = {
  items: OperationLogItem[];
  hasMore: boolean;
  errorMessage: string | null;
  loadMoreErrorMessage: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  onSelect: (operationId: string) => void;
  onLoadMore: () => void;
};

// 유형 탭 (Figma 1436:16604 "위키 페이지 생성 / 다른 로그 명"). 실제 작업 유형으로 나누고 첫 탭은 전체.
const TYPE_TABS: Array<{ type: OperationType | null; label: string }> = [
  { type: null, label: "전체" },
  ...(Object.entries(OPERATION_TYPE_LABELS) as Array<[OperationType, string]>).map(
    ([type, label]) => ({ type, label })
  )
];

/** 선택한 작업의 변경 상세. 선택 행 아래에 펼친다. */
function OperationDetailBody({
  detail,
  errorMessage
}: {
  detail: OperationLogDetail | null;
  errorMessage: string | null;
}) {
  if (errorMessage) return <p className={styles["detail-notice"]} role="alert">{errorMessage}</p>;
  if (!detail) return <p className={styles["detail-notice"]}>로그 불러오는 중…</p>;
  const isWikiOperation = detail.operation_type === "ingest" || detail.operation_type === "lint";
  if (detail.changes.length === 0) {
    return (
      <p className={styles["detail-notice"]}>
        {isWikiOperation ? "생성되거나 삭제된 Wiki가 없습니다." : "변경된 리소스가 없습니다."}
      </p>
    );
  }
  if (isWikiOperation) return <WikiTitles changes={detail.changes} />;
  return (
    <div className={styles["card-body"]}>
      {detail.changes.map((change) => (
        <ChangeDiff key={change.id} change={change} />
      ))}
    </div>
  );
}

/**
 * 로그 화면 (Figma 1436:16438). 날짜별 그룹 아래 작업 행을 나열하고, 고른 작업은 행 아래에 상세를 펼친다.
 * 상단 탭 바(GNB)는 웹 화면이라 적용하지 않는다.
 * feed가 없으면 선택된 작업 1건만 행으로 보여준다.
 */
export function LogView({
  operationId,
  feed,
  restoredOperationIds,
  documentTitles,
  onRestoreComplete
}: {
  operationId: string | null;
  feed?: OperationLogFeedState;
  restoredOperationIds: ReadonlySet<string>;
  documentTitles: ReadonlyMap<string, string>;
  onRestoreComplete: (operationId: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<OperationLogDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [typeFilter, setTypeFilter] = useState<OperationType | null>(null);
  // 접은 날짜 그룹. 폴링으로 목록이 갱신돼도 접힘 상태를 유지한다.
  const [collapsedDateKeys, setCollapsedDateKeys] = useState<ReadonlySet<string>>(new Set());
  // 롤백 확인 모달. preview 결과와 함께 열리고, 확인 시 preview_token으로 실행한다.
  const [pendingRestore, setPendingRestore] = useState<{
    operationId: string;
    previewToken: string;
    message: string;
  } | null>(null);
  const [locallyRestoredOperationIds, setLocallyRestoredOperationIds] = useState<ReadonlySet<string>>(new Set());
  // 선택이 바뀌면 이전 작업의 응답을 버린다. 늦게 온 응답이 다른 작업을 덮어쓰지 않게 한다.
  const requestIdRef = useRef(0);
  // 작업자 이름은 멤버 목록에서 찾는다. 멤버 관리 패널·알림 화면과 같은 캐시를 쓴다.
  const workspaceId = getSelectedWorkspaceId();
  const membersQuery = useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => fetchMembers(workspaceId!),
    enabled: Boolean(workspaceId),
    retry: false
  });
  const memberNames = useMemo(
    () => new Map((membersQuery.data ?? []).map((member) => [member.user_id, member.display_name || member.email])),
    [membersQuery.data]
  );

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setDetail(null);
    setErrorMessage(null);
    // 다른 작업으로 이동하면 열려 있던 롤백 확인 모달을 닫는다.
    setPendingRestore(null);
    setIsRestoring(false);
    if (!operationId) return;
    fetchOperationLogDetail(operationId)
      .then((response) => {
        if (requestIdRef.current === requestId) setDetail(response);
      })
      .catch((error: unknown) => {
        if (requestIdRef.current === requestId) {
          setErrorMessage(getErrorMessage(error, "로그 상세를 불러오지 못했습니다."));
        }
      });
  }, [operationId]);

  const documentTitle = detail?.target_display_name ?? (detail?.target_document_id
    ? documentTitles.get(detail.target_document_id)
    : undefined);
  const description = detail
    ? formatOperationLogDescription(detail, documentTitle)
    : "";
  const canRestore = detail != null
    && detail.operation_type !== "restore"
    && (detail.status === "succeeded" || detail.status === "partially_succeeded")
    && !restoredOperationIds.has(detail.operation_id)
    && !locallyRestoredOperationIds.has(detail.operation_id);

  async function handleRestore() {
    if (!detail || !canRestore || isRestoring) return;
    // 작업 전환 후 늦게 도착한 응답이 새 작업의 상태를 덮어쓰지 않게 세대 값을 잡아둔다.
    const requestId = requestIdRef.current;
    setIsRestoring(true);
    try {
      const preview = await fetchRestorePreview(detail.operation_id);
      if (requestIdRef.current !== requestId) return;
      const affectedCount = preview.delete_count + preview.restore_count + preview.rebuild_count;
      setPendingRestore({
        operationId: detail.operation_id,
        previewToken: preview.preview_token,
        message: preview.document
          ? `${description} 문서를 ${preview.document.from_version}에서 ${preview.document.to_version} 버전으로 되돌립니다.`
          : `${description} 작업을 롤백하면 ${affectedCount}개 Wiki 페이지에 영향을 줍니다.`
      });
    } catch (error: unknown) {
      if (requestIdRef.current !== requestId) return;
      publishNotice({
        kind: "failed",
        title: "롤백 실패",
        message: getErrorMessage(error, "롤백 요청에 실패했습니다.")
      });
      setIsRestoring(false);
    }
  }

  function cancelRestore() {
    setPendingRestore(null);
    setIsRestoring(false);
  }

  async function executeRestore() {
    if (!pendingRestore) return;
    const requestId = requestIdRef.current;
    const { operationId: restoreOperationId, previewToken } = pendingRestore;
    setPendingRestore(null);
    try {
      const result = await restoreOperation(restoreOperationId, previewToken);
      setLocallyRestoredOperationIds((current) => new Set(current).add(restoreOperationId));
      publishNotice({
        // 즉시 끝난 경우에만 작업 id로 로그 폴링의 완료 알림과 중복을 거른다. 시작 안내는 완료 알림과 별개다.
        operation: { type: "restore", id: result.status === "succeeded" ? result.operation_id : undefined },
        kind: "completed",
        title: "롤백 요청 완료",
        message: result.status === "succeeded" ? "작업을 롤백했습니다." : "롤백 작업을 시작했습니다."
      });
      await onRestoreComplete(restoreOperationId);
    } catch (error: unknown) {
      publishNotice({
        kind: "failed",
        title: "롤백 실패",
        message: getErrorMessage(error, "롤백 요청에 실패했습니다.")
      });
    } finally {
      // 실행 중 다른 작업으로 이동해 새 요청이 시작됐다면, 늦은 해제가 새 작업의 "처리 중" 표시를 풀지 않게 한다.
      if (requestIdRef.current === requestId) setIsRestoring(false);
    }
  }

  // feed가 없으면 상세 응답(목록 항목 필드 포함)을 행 1개로 쓴다.
  const allItems = feed?.items ?? (detail ? [detail] : []);
  const visibleItems = filterOperationLogsByType(allItems, typeFilter);
  const groups = groupOperationLogsByDate(visibleItems);
  const rollbackDisabledReason = !detail
    ? "롤백할 작업을 선택하세요."
    : canRestore ? undefined : "롤백할 수 없는 작업입니다.";

  function selectType(type: OperationType | null) {
    setTypeFilter(type);
    // 고른 작업이 새 탭에 없으면 탭의 가장 최근 작업으로 옮긴다.
    const nextItems = filterOperationLogsByType(allItems, type);
    if (feed && nextItems.length > 0 && !nextItems.some((item) => item.operation_id === operationId)) {
      feed.onSelect(nextItems[0].operation_id);
    }
  }

  function toggleGroup(dateKey: string) {
    setCollapsedDateKeys((current) => {
      const next = new Set(current);
      if (!next.delete(dateKey)) next.add(dateKey);
      return next;
    });
  }

  function documentTitleOf(item: OperationLogItem) {
    return item.target_display_name
      ?? (item.target_document_id ? documentTitles.get(item.target_document_id) : undefined);
  }

  return (
    <section className={styles["logs"]} aria-label="로그">
      <header className={styles["logs-hero"]}>
        <div className={styles["logs-title"]}>
          <h2>로그</h2>
          <p>워크스페이스 활동 기록입니다.</p>
        </div>
        <div className={styles["tabs-bar"]}>
          <div className={styles["tabs"]} role="tablist" aria-label="작업 유형">
            {TYPE_TABS.map(({ type, label }) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={typeFilter === type}
                className={cx(styles["tab"], typeFilter === type && styles["is-active"])}
                onClick={() => selectType(type)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles["rollback-button"]}
            onClick={() => void handleRestore()}
            disabled={!canRestore || isRestoring}
            title={rollbackDisabledReason}
          >
            <SvgIcon src={retryIcon} className={styles["rollback-icon"]} />
            {isRestoring ? "처리 중…" : "Rollback"}
          </button>
        </div>
      </header>

      <div className={styles["logs-list"]} role="tabpanel">
        {feed?.errorMessage ? (
          <p className={styles["logs-message"]} role="alert">{feed.errorMessage}</p>
        ) : feed?.isLoading && allItems.length === 0 ? (
          <p className={styles["logs-message"]}>로그 불러오는 중…</p>
        ) : !feed && !operationId ? (
          <p className={styles["logs-message"]}>왼쪽 목록에서 작업을 선택하세요.</p>
        ) : !feed && errorMessage ? (
          <p className={styles["logs-message"]} role="alert">{errorMessage}</p>
        ) : !feed && !detail ? (
          <p className={styles["logs-message"]}>로그 불러오는 중…</p>
        ) : visibleItems.length === 0 ? (
          <p className={styles["logs-message"]}>
            {allItems.length === 0 ? "아직 기록된 AI 작업이 없습니다." : "이 유형의 작업이 없습니다."}
          </p>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsedDateKeys.has(group.dateKey);
            return (
              <section key={group.dateKey} className={styles["group"]} aria-label={group.label}>
                <button
                  type="button"
                  className={styles["group-header"]}
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleGroup(group.dateKey)}
                >
                  <span className={styles["group-title"]}>
                    <span>{group.label}</span>
                    <span className={styles["group-count"]}>{group.items.length}</span>
                  </span>
                  <SvgIcon
                    src={chevronDownSmallIcon}
                    className={cx(styles["group-chevron"], isCollapsed && styles["is-collapsed"])}
                  />
                </button>
                {!isCollapsed && (
                  <ul className={styles["rows"]}>
                    {group.items.map((item) => {
                      const isSelected = item.operation_id === operationId;
                      const rowStatusLabel = STATUS_LABELS[item.status];
                      return (
                        <li
                          key={item.operation_id}
                          className={cx(styles["row"], isSelected && styles["is-selected"])}
                        >
                          <button
                            type="button"
                            className={styles["row-summary"]}
                            aria-current={isSelected || undefined}
                            onClick={() => feed?.onSelect(item.operation_id)}
                          >
                            <span className={styles["row-title-line"]}>
                              <span className={styles["row-heading"]}>
                                <span className={styles["row-date"]}>
                                  {formatOperationLogDateTime(item.created_at)}
                                </span>
                                <span className={styles["row-divider"]} aria-hidden />
                                <span className={styles["row-title"]}>{formatOperationLogTitle(item)}</span>
                              </span>
                              {isSelected && <span className={styles["row-dot"]} aria-hidden />}
                            </span>
                            <span className={styles["row-description"]}>
                              {formatOperationLogDescription(item, documentTitleOf(item))}
                            </span>
                            <span className={styles["row-meta"]}>
                              <span className={styles["row-meta-info"]}>
                                {/* 작업자 (Figma 1485:1725): 프로필 원 + 이름. 응답에 작업자가 없으면 변경 건수를 둔다. */}
                                {item.user_id ? (
                                  <span className={styles["row-worker"]}>
                                    <span className={styles["row-worker-icon"]} aria-hidden />
                                    {memberNames.get(item.user_id) ?? "알 수 없는 작업자"}
                                  </span>
                                ) : (
                                  <span>변경 {item.changed_resource_count}건</span>
                                )}
                                {rowStatusLabel && (
                                  <span className={cx(styles["row-status"], item.status === "failed" && styles["is-failed"])}>
                                    {rowStatusLabel}
                                  </span>
                                )}
                              </span>
                              <span className={styles["row-time"]}>{formatRelativeTime(item.created_at)}</span>
                            </span>
                          </button>
                          {isSelected && (
                            <div className={styles["row-detail"]}>
                              <OperationDetailBody detail={detail} errorMessage={errorMessage} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })
        )}
        {feed?.hasMore && (
          <button
            type="button"
            className={styles["more-button"]}
            onClick={feed.onLoadMore}
            disabled={feed.isLoadingMore}
          >
            {feed.isLoadingMore ? "불러오는 중…" : feed.loadMoreErrorMessage ? "다시 시도" : "더 보기"}
          </button>
        )}
        {feed?.loadMoreErrorMessage && (
          <p className={styles["logs-message"]} role="alert">{feed.loadMoreErrorMessage}</p>
        )}
      </div>
      {pendingRestore && (
        <ConfirmModal
          titleId="restore-confirm-title"
          title="작업을 롤백하시겠습니까?"
          description={pendingRestore.message}
          confirmLabel="롤백"
          onConfirm={() => void executeRestore()}
          onCancel={cancelRestore}
        />
      )}
    </section>
  );
}
