"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTrashDocuments, restoreTrashDocument } from "@/entities/document/api/trash";
import { describePurge, describeRestoreError, isRetentionExpired } from "@/entities/document/lib/trashRetention";
import { getErrorMessage } from "@/shared/lib/errors";
import { getSelectedWorkspaceId } from "@/shared/lib/auth";
import styles from "./CollabSections.module.css";

const TRASH_QUERY_KEY = (workspaceId: string | null) => ["document-trash", workspaceId] as const;

const dateFormat = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

/** 문서 휴지통: 영구 삭제 예정일(purge_at)을 보여주고 복구한다. 보관 기간(30일)이 지난 항목은 복구할 수 없다. */
export function TrashSection() {
  const queryClient = useQueryClient();
  const workspaceId = getSelectedWorkspaceId();
  const trash = useQuery({
    queryKey: TRASH_QUERY_KEY(workspaceId),
    queryFn: fetchTrashDocuments,
    enabled: Boolean(workspaceId)
  });
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const items = trash.data ?? [];

  async function restore(documentId: string, currentVersion: number, name: string) {
    setRestoringId(documentId);
    setMessage(null);
    try {
      await restoreTrashDocument(documentId, currentVersion);
      setMessage(`「${name}」 문서를 복구했습니다. 편집 문서는 미편입 상태로 돌아오므로 다시 위키에 편입해야 합니다.`);
    } catch (error) {
      setMessage(describeRestoreError(error));
    } finally {
      setRestoringId(null);
      await queryClient.invalidateQueries({ queryKey: TRASH_QUERY_KEY(workspaceId) });
      // 복구된 문서가 트리에 다시 나타나도록 문서 목록을 다시 받는다.
      await queryClient.invalidateQueries({ queryKey: ["backendData", workspaceId] });
    }
  }

  return (
    <section className={styles["settings-section"]} aria-labelledby="document-trash-heading">
      <h3 id="document-trash-heading">휴지통</h3>
      <p className={styles["settings-section-description"]}>
        삭제한 문서는 30일 동안 보관된 뒤 영구 삭제됩니다. 복구는 문서 소유자와 OWNER만 할 수 있습니다.
      </p>
      {trash.isLoading && <p className={styles["settings-list-empty"]}>휴지통을 불러오는 중입니다.</p>}
      {trash.isError && (
        <p className={styles["settings-message"]} role="alert">{getErrorMessage(trash.error, "휴지통을 불러오지 못했습니다.")}</p>
      )}
      {!trash.isLoading && !trash.isError && items.length === 0 && (
        <p className={styles["settings-list-empty"]}>휴지통이 비어 있습니다.</p>
      )}
      <ul className={styles["settings-list"]}>
        {items.map((item) => {
          const expired = isRetentionExpired(item.purge_at);
          return (
            <li key={item.id} className={styles["settings-list-item"]}>
              <div className={styles["settings-list-row"]}>
                <div className={styles["settings-label"]}>
                  <p>{item.filename || item.display_name}</p>
                  <span>{formatTime(item.deleted_at)} 삭제 · {describePurge(item.purge_at)}</span>
                </div>
                <button
                  type="button"
                  className={`${styles["settings-small-button"]} ${styles["is-primary"]}`}
                  disabled={expired || restoringId === item.id}
                  title={expired ? "보관 기간이 지나 복구할 수 없습니다." : undefined}
                  onClick={() => void restore(item.id, item.current_version, item.filename || item.display_name)}
                >
                  {restoringId === item.id ? "복구 중…" : "복구"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {message && <p className={styles["settings-message"]} role="status">{message}</p>}
    </section>
  );
}
