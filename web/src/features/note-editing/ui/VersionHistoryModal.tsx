"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMembers } from "@/entities/workspace/api/members";
import { splitEditableNoteMarkdown } from "@/entities/document/lib/noteMarkdown";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { cx } from "@/shared/lib/classNames";
import { CenteredModal } from "@/shared/ui/modal/CenteredModal";
import modalStyles from "@/shared/ui/modal/CenteredModal.module.css";
import { MarkdownViewer } from "@/shared/ui/markdown/LazyMarkdownViewer";
import { plusIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { fetchDocumentVersion, fetchDocumentVersions, restoreDocumentVersion, versionMergeStatusLabel } from "../api/versions";
import styles from "./VersionHistoryModal.module.css";

const dateFormat = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

/**
 * 문서 버전 기록: 저장 이력 목록·본문 미리보기·복원.
 * 자동 병합으로 겹친 부분이 덮였을 때 이전 내용을 되살리는 곳이다. 복원도 새 버전으로 저장되므로 지금 본문은 기록에 남는다.
 */
export function VersionHistoryModal({
  documentId,
  onBeforeRestore,
  onRestored,
  onClose
}: {
  documentId: string;
  /** 복원 전에 편집기의 저장 대기분을 먼저 저장한다. */
  onBeforeRestore?: () => Promise<unknown>;
  /** 복원 뒤 열린 문서를 다시 불러온다. */
  onRestored: () => void;
  onClose: () => void;
}) {
  const versions = useQuery({
    queryKey: ["document-versions", documentId],
    queryFn: () => fetchDocumentVersions(documentId),
    retry: false
  });
  const workspaceId = getSelectedWorkspaceId();
  const members = useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => fetchMembers(workspaceId!),
    enabled: Boolean(workspaceId),
    retry: false
  });
  const memberNames = useMemo(
    () => new Map((members.data ?? []).map((member) => [member.user_id, member.display_name || member.email])),
    [members.data]
  );
  const items = useMemo(() => versions.data?.versions ?? [], [versions.data]);
  const currentVersion = versions.data?.current_version ?? null;
  const [selected, setSelected] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 처음에는 현재 바로 앞 버전(덮이기 전 내용일 가능성이 가장 큰 쪽)을 보여 준다.
  useEffect(() => {
    if (selected !== null || items.length === 0) return;
    setSelected((items.find((item) => item.version !== currentVersion) ?? items[0]).version);
  }, [currentVersion, items, selected]);

  const preview = useQuery({
    queryKey: ["document-version", documentId, selected],
    queryFn: () => fetchDocumentVersion(documentId, selected!),
    enabled: selected !== null,
    retry: false
  });
  const previewBody = preview.data
    ? splitEditableNoteMarkdown(preview.data.markdown)?.body ?? preview.data.markdown
    : null;

  async function restore(version: number) {
    setIsRestoring(true);
    setMessage(null);
    try {
      await onBeforeRestore?.();
      // 기준 버전은 복원 직전에 다시 읽는다. 오래된 기준이면 서버가 복원 대신 병합해 버리기 때문이다.
      const latest = await fetchDocumentVersions(documentId);
      await restoreDocumentVersion(documentId, version, latest.current_version);
      onRestored();
      onClose();
    } catch (error) {
      setMessage(getErrorMessage(error, "이 버전으로 복원하지 못했습니다."));
      setIsRestoring(false);
    }
  }

  return (
    <CenteredModal ariaLabel="버전 기록" className={styles.box} onClose={onClose}>
      <div className={modalStyles["modal-header"]}>
        <h2 className={styles.title}>버전 기록</h2>
        <button type="button" className={modalStyles["modal-close"]} aria-label="버전 기록 닫기" onClick={onClose}>
          <SvgIcon src={plusIcon} className={modalStyles["modal-close-icon"]} />
        </button>
      </div>
      <div className={styles.body}>
        <div className={styles.list} role="listbox" aria-label="저장된 버전">
          {versions.isLoading && <p className={styles.empty}>버전 기록을 불러오는 중입니다.</p>}
          {versions.isError && (
            <p className={styles.error} role="alert">{getErrorMessage(versions.error, "버전 기록을 불러오지 못했습니다.")}</p>
          )}
          {!versions.isLoading && !versions.isError && items.length === 0 && <p className={styles.empty}>저장된 버전이 없습니다.</p>}
          {items.map((item) => {
            const isCurrent = item.version === currentVersion;
            const author = item.created_by ? memberNames.get(item.created_by) ?? item.created_by : null;
            const mergeLabel = versionMergeStatusLabel(item.merge_status);
            return (
              <button
                key={item.version}
                type="button"
                role="option"
                aria-selected={selected === item.version}
                className={cx(styles.item, selected === item.version && styles["is-selected"])}
                onClick={() => setSelected(item.version)}
              >
                <strong>
                  버전 {item.version}
                  {isCurrent && <span className={styles.badge}>현재</span>}
                  {mergeLabel && <span className={cx(styles.badge, styles["is-merge"])}>{mergeLabel}</span>}
                </strong>
                <span>{formatTime(item.created_at)}{author ? ` · ${author}` : ""}</span>
              </button>
            );
          })}
        </div>
        <section className={styles.preview} aria-label="버전 미리보기">
          {selected === null && !versions.isLoading && <p className={styles.empty}>버전을 고르면 본문을 미리 볼 수 있어요.</p>}
          {preview.isLoading && <p className={styles.empty}>본문을 불러오는 중입니다.</p>}
          {preview.isError && (
            <p className={styles.error} role="alert">{getErrorMessage(preview.error, "이 버전의 본문을 불러오지 못했습니다.")}</p>
          )}
          {previewBody !== null && (
            <div className={styles["preview-body"]}>
              <MarkdownViewer markdown={previewBody} />
            </div>
          )}
          <div className={styles.actions}>
            {message && <p className={styles.error} role="alert">{message}</p>}
            <button
              type="button"
              className={styles.restore}
              disabled={selected === null || selected === currentVersion || isRestoring || !preview.data}
              onClick={() => selected !== null && void restore(selected)}
            >
              {isRestoring ? "복원 중…" : "이 버전으로 복원"}
            </button>
          </div>
        </section>
      </div>
    </CenteredModal>
  );
}
