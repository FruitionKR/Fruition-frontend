"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTrashDocuments, restoreTrashDocument, TRASH_QUERY_KEY } from "@/entities/document/api/trash";
import { describePurge, describeRestoreError, documentRestoredMessage, isRetentionExpired, restoredDocumentFolderName } from "@/entities/document/lib/trashRetention";
import { fetchDocumentTree } from "@/entities/tree/api/documentTree";
import { publishNotice } from "@/features/document-notifications";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import sectionStyles from "./CollabSections.module.css";
import styles from "./TrashList.module.css";

const DELETED_AT_FORMAT = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } as const;

/**
 * 설정 화면에 바로 표시하는 문서 휴지통 목록.
 * 삭제 문서의 이름·삭제 시각·영구 삭제 예정일(purge_at)을 보여주고 복구한다. 보관 기간(30일)이 지난 항목은 복구할 수 없다.
 * 복구는 문서 소유자와 OWNER만 할 수 있고, 다른 멤버는 서버 403을 문구로 안내받는다.
 */
export function TrashList() {
  const t = useTranslations("settings.trash");
  const tShared = useTranslations("shared");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const workspaceId = getSelectedWorkspaceId();
  const trash = useQuery({
    queryKey: TRASH_QUERY_KEY(workspaceId),
    queryFn: fetchTrashDocuments,
    enabled: Boolean(workspaceId)
  });
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const items = trash.data ?? [];

  async function restore(documentId: string, currentVersion: number, name: string) {
    setRestoringId(documentId);
    setRestoreError(null);
    setRestoreMessage(null);
    try {
      await restoreTrashDocument(documentId, currentVersion);
      // 원래 폴더가 지워졌으면 최상위로 돌아가므로 실제 위치를 트리에서 찾는다. 찾지 못해도 복구는 끝났다.
      const folderName = await fetchDocumentTree().then((tree) => restoredDocumentFolderName(tree.items, documentId)).catch(() => undefined);
      const message = documentRestoredMessage(name, folderName, tShared);
      setRestoreMessage(message);
      publishNotice({
        kind: "completed",
        title: t("restoredTitle"),
        message
      });
    } catch (error) {
      setRestoreError(describeRestoreError(error, undefined, tShared));
    } finally {
      setRestoringId(null);
      await queryClient.invalidateQueries({ queryKey: TRASH_QUERY_KEY(workspaceId) });
      // 복구된 문서가 트리에 다시 나타나도록 문서 목록을 다시 받는다.
      await queryClient.invalidateQueries({ queryKey: ["backendData", workspaceId] });
    }
  }

  function formatTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : format.dateTime(date, DELETED_AT_FORMAT);
  }

  return (
      <div className={styles.body} aria-busy={trash.isLoading}>
        <p className={styles.description}>
          {t("retention")}
        </p>
        {trash.isLoading && <p className={styles.empty}>{t("loading")}</p>}
        {trash.isError && (
          <p className={sectionStyles["settings-message"]} role="alert">{getErrorMessage(trash.error, t("loadFailed"), tShared)}</p>
        )}
        {!trash.isLoading && !trash.isError && items.length === 0 && <p className={styles.empty}>{t("empty")}</p>}
        <ul className={styles.list}>
          {items.map((item) => {
            const expired = isRetentionExpired(item.purge_at);
            const name = item.filename || item.display_name;
            return (
              <li key={item.id} className={styles.item}>
                <div className={styles["item-text"]}>
                  <p>{name}</p>
                  <span>{t("deletedAt", { time: formatTime(item.deleted_at), purge: describePurge(item.purge_at, undefined, tShared) })}</span>
                </div>
                <button
                  type="button"
                  className={`${sectionStyles["settings-small-button"]} ${sectionStyles["is-primary"]}`}
                  disabled={expired || restoringId === item.id}
                  title={expired ? t("expired") : undefined}
                  onClick={() => void restore(item.id, item.current_version, name)}
                >
                  {restoringId === item.id ? t("restoring") : t("restore")}
                </button>
              </li>
            );
          })}
        </ul>
        {restoreError && <p className={sectionStyles["settings-message"]} role="alert">{restoreError}</p>}
        {restoreMessage && <p className={`${sectionStyles["settings-message"]} ${sectionStyles["is-success"]}`} role="status">{restoreMessage}</p>}
      </div>
  );
}
