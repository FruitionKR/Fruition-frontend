"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchEditConflicts, resolveEditConflict, type EditConflictEntry } from "@/features/note-editing/api/editConflict";
import { buildResolveRequest, describeResolveError, type ConflictChoice } from "@/features/note-editing/model/editConflict";
import { getErrorMessage } from "@/shared/lib/errors";
import { getSelectedWorkspaceId } from "@/shared/lib/auth";
import styles from "./SettingsPanel.module.css";

export const EDIT_CONFLICTS_QUERY_KEY = (workspaceId: string | null) => ["edit-conflicts", workspaceId] as const;

const dateFormat = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

/**
 * OWNER용 미해결 편집 충돌 목록. 충돌 본과 서버 현재 본을 비교해 하나를 고른다.
 * 합치기(merged)는 비교 편집기가 없어 제공하지 않는다.
 */
export function EditConflictSection() {
  const queryClient = useQueryClient();
  const workspaceId = getSelectedWorkspaceId();
  const conflicts = useQuery({
    queryKey: EDIT_CONFLICTS_QUERY_KEY(workspaceId),
    queryFn: fetchEditConflicts,
    enabled: Boolean(workspaceId)
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function resolve(entry: EditConflictEntry, choice: ConflictChoice) {
    setResolvingId(entry.conflict.id);
    setMessage(null);
    try {
      await resolveEditConflict(entry.conflict.id, buildResolveRequest(choice, entry.server.revision));
      setMessage(`「${entry.document_name}」 충돌을 ${choice === "server" ? "서버 본 유지" : "충돌 본 적용"}으로 해결했습니다.`);
    } catch (error) {
      setMessage(describeResolveError(error));
    } finally {
      setResolvingId(null);
      await queryClient.invalidateQueries({ queryKey: EDIT_CONFLICTS_QUERY_KEY(workspaceId) });
      // 충돌 본을 적용하면 문서 본문·revision이 바뀌므로 문서 목록도 다시 받는다.
      await queryClient.invalidateQueries({ queryKey: ["backendData", workspaceId] });
    }
  }

  const entries = conflicts.data ?? [];

  return (
    <section className={styles["settings-section"]} aria-labelledby="edit-conflicts-heading">
      <h3 id="edit-conflicts-heading">편집 충돌</h3>
      <p className={styles["settings-section-description"]}>
        같은 revision에서 두 사람이 고친 본문이 겹치면 늦게 저장한 쪽이 여기에 등록됩니다. OWNER가 어느 본문을 남길지 고릅니다.
      </p>
      {conflicts.isLoading && <p className={styles["settings-list-empty"]}>충돌 목록을 불러오는 중입니다.</p>}
      {conflicts.isError && (
        <p className={styles["settings-message"]} role="alert">{getErrorMessage(conflicts.error, "편집 충돌 목록을 불러오지 못했습니다.")}</p>
      )}
      {!conflicts.isLoading && !conflicts.isError && entries.length === 0 && (
        <p className={styles["settings-list-empty"]}>미해결 편집 충돌이 없습니다.</p>
      )}
      <ul className={styles["settings-list"]}>
        {entries.map((entry) => {
          const { conflict, server } = entry;
          const isOpen = openId === conflict.id;
          const isResolving = resolvingId === conflict.id;
          return (
            <li key={conflict.id} className={styles["settings-list-item"]}>
              <div className={styles["settings-list-row"]}>
                <div className={styles["settings-label"]}>
                  <p>{entry.document_name}</p>
                  <span>
                    {formatTime(conflict.created_at)} · 작성자 {conflict.author_user_id} · 기준 revision {conflict.base_revision} → 서버 revision {server.revision}
                  </span>
                </div>
                <div className={styles["settings-list-actions"]}>
                  <button type="button" className={styles["settings-small-button"]} onClick={() => setOpenId(isOpen ? null : conflict.id)}>
                    {isOpen ? "비교 닫기" : "비교"}
                  </button>
                  <button type="button" className={styles["settings-small-button"]} disabled={isResolving} onClick={() => void resolve(entry, "server")}>
                    서버 본 유지
                  </button>
                  <button type="button" className={`${styles["settings-small-button"]} ${styles["is-primary"]}`} disabled={isResolving} onClick={() => void resolve(entry, "conflict")}>
                    충돌 본 적용
                  </button>
                </div>
              </div>
              {isOpen && (
                <div className={styles["settings-compare"]}>
                  <div>
                    <p>서버 현재 본 (revision {server.revision}{server.updated_by ? `, ${server.updated_by}` : ""})</p>
                    <pre>{server.markdown}</pre>
                  </div>
                  <div>
                    <p>충돌 본 ({conflict.author_user_id})</p>
                    <pre>{conflict.markdown}</pre>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {message && <p className={styles["settings-message"]} role="status">{message}</p>}
    </section>
  );
}
