"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getErrorMessage } from "@/shared/lib/errors";
import {
  fetchDocumentVersion,
  fetchDocumentVersionDiff,
  fetchDocumentVersions,
  type DocumentVersionListResponse
} from "../api/versions";
import { flattenDiffHunks, type VersionDiffRow } from "../lib/versionDiff";
import { groupVersionsByInterval, VERSION_GROUP_INTERVAL_MS } from "../lib/versionGroups";
import type { ViewedDocumentVersion } from "./VersionPreview";
import styles from "./HistoryPanel.module.css";

const DIFF_MARKERS: Record<VersionDiffRow["type"], string> = {
  context: " ",
  delete: "−",
  insert: "+",
  gap: " "
};

function formatTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function HistoryPanel({
  documentId,
  viewingVersion,
  refreshKey,
  onBeforeViewVersion,
  onViewVersion,
  onExitVersionView,
  onClose
}: {
  documentId: string;
  /** 지금 읽기 전용으로 열어 둔 버전. 없으면 null(편집 중인 현재 문서). */
  viewingVersion: number | null;
  /** 값이 바뀌면 버전 목록을 다시 불러온다(복원 후 등). */
  refreshKey: number;
  /** 버전을 열기 전에 대기 중인 저장을 flush한다. 저장하지 못하면 false를 반환하고 열람하지 않는다. */
  onBeforeViewVersion: () => Promise<boolean>;
  onViewVersion: (viewed: ViewedDocumentVersion) => void;
  onExitVersionView: () => void;
  onClose: () => void;
}) {
  const [versionData, setVersionData] = useState<DocumentVersionListResponse | null>(null);
  const [diffRows, setDiffRows] = useState<VersionDiffRow[] | null>(null);
  const [isDiffLoading, setIsDiffLoading] = useState(false);
  const [openingVersion, setOpeningVersion] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedVersion = viewingVersion;

  const loadVersions = useCallback(async () => {
    const data = await fetchDocumentVersions(documentId);
    setVersionData(data);
    return data;
  }, [documentId]);

  useEffect(() => {
    let ignore = false;
    setVersionData(null);
    setDiffRows(null);
    setErrorMessage(null);
    loadVersions().catch((error: unknown) => {
      if (!ignore) setErrorMessage(getErrorMessage(error, "버전 이력을 불러오지 못했습니다."));
    });
    return () => {
      ignore = true;
    };
  }, [loadVersions, refreshKey]);

  const currentVersion = versionData?.current_version ?? null;
  // 자동 저장마다 쌓이는 버전을 일정 간격 스냅샷처럼 묶어 보여 준다. 실제 저장 단위는 서버가 정한다.
  const visibleVersions = useMemo(
    () => groupVersionsByInterval(versionData?.versions ?? [], VERSION_GROUP_INTERVAL_MS, currentVersion),
    [currentVersion, versionData]
  );
  const selected = useMemo(
    () => versionData?.versions.find((item) => item.version === selectedVersion) ?? null,
    [selectedVersion, versionData]
  );
  const isSelectedCurrent = selectedVersion !== null && selectedVersion === currentVersion;

  useEffect(() => {
    if (selectedVersion === null || currentVersion === null || selectedVersion === currentVersion) {
      setDiffRows(null);
      return;
    }
    let ignore = false;
    setIsDiffLoading(true);
    setDiffRows(null);
    fetchDocumentVersionDiff(documentId, selectedVersion, currentVersion)
      .then((diff) => {
        if (!ignore) setDiffRows(flattenDiffHunks(diff.hunks));
      })
      .catch((error: unknown) => {
        if (!ignore) setErrorMessage(getErrorMessage(error, "버전 비교 결과를 불러오지 못했습니다."));
      })
      .finally(() => {
        if (!ignore) setIsDiffLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [currentVersion, documentId, selectedVersion]);

  async function handleSelectVersion(version: number) {
    if (openingVersion !== null) return;
    if (version === currentVersion) {
      onExitVersionView();
      return;
    }
    setOpeningVersion(version);
    setErrorMessage(null);
    try {
      // 열람 중에는 저장하지 않으므로 미저장 편집분을 먼저 서버에 남긴다.
      if (!(await onBeforeViewVersion())) {
        setErrorMessage("저장되지 않은 편집 내용이 있어 버전을 열지 않았습니다. 저장 상태를 확인해 주세요.");
        return;
      }
      // 방금 저장으로 현재 버전이 바뀌었을 수 있어 목록을 다시 받아 복원 기준 버전으로 쓴다.
      const latest = await loadVersions();
      if (version === latest.current_version) {
        onExitVersionView();
        return;
      }
      const content = await fetchDocumentVersion(documentId, version);
      onViewVersion({ documentId, version, markdown: content.markdown, baseVersion: latest.current_version });
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "버전 본문을 불러오지 못했습니다."));
    } finally {
      setOpeningVersion(null);
    }
  }

  const hasChanges = (diffRows?.some((row) => row.type === "delete" || row.type === "insert")) ?? false;

  return (
    <aside className={styles["history-panel"]} aria-label="문서 버전 기록" onClick={(event) => event.stopPropagation()}>
      <header className={styles["history-panel-header"]}>
        <strong>버전 기록</strong>
        <button type="button" aria-label="기록 닫기" onClick={onClose}>✕</button>
      </header>

      {errorMessage && <p className={styles["history-error"]} role="alert">{errorMessage}</p>}

      {versionData === null && !errorMessage ? (
        <p className={styles["history-empty"]}>버전 이력을 불러오는 중입니다.</p>
      ) : versionData !== null && versionData.versions.length === 0 ? (
        <p className={styles["history-empty"]}>아직 저장된 버전이 없습니다. 문서를 저장하면 버전이 기록됩니다.</p>
      ) : versionData !== null ? (
        <ol className={styles["history-list"]} aria-label={`${VERSION_GROUP_INTERVAL_MS / 60_000}분 간격으로 묶은 버전 목록`}>
          {visibleVersions.map((item) => (
            <li key={item.version}>
              <button
                type="button"
                className={`${styles["history-item"]}${item.version === selectedVersion ? ` ${styles["is-selected"]}` : ""}`}
                aria-pressed={item.version === selectedVersion}
                disabled={openingVersion !== null}
                onClick={() => void handleSelectVersion(item.version)}
              >
                <span className={styles["history-item-label"]}>
                  v{item.version}
                  {item.version === currentVersion && <em className={styles["history-item-badge"]}>현재</em>}
                  {item.restored_from_version != null && (
                    <span className={styles["history-item-restored"]}>v{item.restored_from_version}에서 복원</span>
                  )}
                </span>
                <span className={styles["history-item-time"]}>
                  {item.version === openingVersion ? "여는 중…" : formatTimestamp(item.created_at)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      {selected && (
        <section className={styles["history-detail"]} aria-label="선택한 버전과 현재 버전 비교">
          {isSelectedCurrent ? (
            <p className={styles["history-nodiff"]}>현재 버전입니다.</p>
          ) : isDiffLoading ? (
            <p className={styles["history-nodiff"]}>비교 결과를 불러오는 중입니다.</p>
          ) : diffRows !== null ? (
            <div className={styles["history-diff"]}>
              {hasChanges ? (
                diffRows.map((row, index) => (
                  <code className={styles[`is-${row.type}`]} key={`${row.type}-${index}`}>
                    <span aria-hidden="true">{DIFF_MARKERS[row.type]}</span>
                    {row.text || " "}
                  </code>
                ))
              ) : (
                <p className={styles["history-nodiff"]}>이 버전과 현재 문서가 동일합니다.</p>
              )}
            </div>
          ) : null}
        </section>
      )}
    </aside>
  );
}
