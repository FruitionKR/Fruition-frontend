"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/entities/user";
import { uploadWorkspaceIcon, useSelectedWorkspace, type WorkspaceListResponse, type WorkspaceResponse } from "@/entities/workspace";
import { fetchMembers } from "@/entities/workspace/api/members";
import { WorkspaceIcon } from "@/entities/workspace/ui/WorkspaceIcon";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import styles from "../SettingsModal.module.css";

/**
 * 워크스페이스 아이콘 (Figma 1512:15289): 제목·설명 + 80px 타일. 타일을 누르면 이미지를 올린다(OWNER만).
 * 이모티콘 선택은 없앴다. 예전에 저장한 icon_emoji는 서버에 그대로 두고 여기서는 이름 첫 글자를 보여 준다.
 */
export function WorkspaceIconSettings() {
  const workspace = useSelectedWorkspace();
  const { data: me } = useMe();
  const { data: members, error: membersError } = useQuery({
    queryKey: ["workspace-members", workspace?.id],
    queryFn: () => fetchMembers(workspace!.id),
    enabled: Boolean(workspace), retry: false
  });
  const isOwner = members?.some((member) => member.user_id === me?.id && member.role === "OWNER") ?? false;
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(file: File) {
    if (file.size === 0 || file.size > 1024 * 1024) {
      setError("빈 파일은 사용할 수 없습니다. 1MB 이하 이미지를 선택해 주세요.");
      setSaved(false);
      return;
    }
    await apply(() => uploadWorkspaceIcon(workspace!.id, file));
  }

  async function apply(request: () => Promise<WorkspaceResponse>) {
    if (!workspace || !isOwner || busy) return;
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const updated = await request();
      queryClient.setQueryData<WorkspaceListResponse>(["workspaces"], (current) => current && ({
        ...current, workspaces: current.workspaces.map((item) => item.id === updated.id ? updated : item)
      }));
      void queryClient.invalidateQueries({ queryKey: ["workspace-icon", workspace.id] });
      setSaved(true);
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "아이콘을 변경하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  const loadError = error || (membersError ? getErrorMessage(membersError, "아이콘 변경 권한을 확인하지 못했습니다.") : null);

  return <div className={styles["tile-field"]}>
    <div className={styles["row-title"]}>
      <strong>워크스페이스 아이콘</strong>
      <small>이미지를 업로드하세요 (100*100 사이즈를 추천드립니다.)</small>
    </div>
    <button type="button" className={styles["tile-button"]} aria-label="워크스페이스 아이콘 이미지 업로드"
      disabled={!isOwner || busy} onClick={() => fileInput.current?.click()}>
      <WorkspaceIcon workspace={workspace} className={styles["tile-face"]} hideEmoji />
    </button>
    <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" disabled={!isOwner || busy}
      onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void save(file); }} />
    {(!isOwner || busy || saved || loadError) && (
      <div className={styles["tile-actions"]}>
        {!isOwner && !membersError && <small className={styles["status-text"]}>아이콘 변경은 워크스페이스 OWNER만 할 수 있습니다.</small>}
        {busy && <small className={styles["status-text"]} role="status">아이콘 저장 중…</small>}
        {saved && <small className={styles["status-text"]} role="status">아이콘을 변경했습니다.</small>}
        {loadError && <small className={styles["field-error"]} role="alert">{loadError}</small>}
      </div>
    )}
  </div>;
}
