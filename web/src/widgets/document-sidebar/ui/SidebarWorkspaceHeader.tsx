import { MoreVertical, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSelectedWorkspace } from "@/entities/workspace/model/useSelectedWorkspace";
import { WorkspaceIcon } from "@/entities/workspace/ui/WorkspaceIcon";
import { createWorkspace, deleteWorkspace, describeLimitError, fetchWorkspaces, isFreeWorkspaceLimitReached } from "@/entities/workspace";
import { fetchMembers, removeMember } from "@/entities/workspace/api/members";
import { useMe } from "@/entities/user";
import { clearSelectedWorkspaceId, getSelectedWorkspaceId, setSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { clearWorkspaceGone } from "@/shared/lib/workspaceAccess";
import { useDismissOnOutside } from "@/shared/hooks/useDismissOnOutside";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { LoadingOverlay } from "@/shared/ui/LoadingOverlay";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";
import { Tooltip } from "@/shared/ui/Tooltip";
import type { WorkspaceResponse } from "@/entities/workspace";
import { SidebarWorkspaceChevronIcon } from "./SidebarIcons";
import { workspaceSwitchHref } from "@/widgets/workspace/lib/workspaceLocation";
import { canLeaveWorkspace, getWorkspaceMenuRole, type WorkspaceMenuRole } from "../model/workspaceMenu";
import styles from "./DocumentSidebar.module.css";

/** 선택한 워크스페이스로 전환하고 화면을 새로 그린다. 이전 워크스페이스의 문서 주소(?doc= 등)는 버린다. */
function switchWorkspace(workspaceId: string) {
  setSelectedWorkspaceId(workspaceId);
  clearWorkspaceGone(workspaceId);
  window.location.assign(workspaceSwitchHref(new URLSearchParams(window.location.search)));
}

// 행 옵션 메뉴 너비. 채팅 세션 메뉴(.chat-session-menu-list)와 같다.
const ROW_MENU_WIDTH = 132;

// 무료 워크스페이스 소유 한도에 닿았을 때 새 워크스페이스 버튼의 안내
const FREE_WORKSPACE_LIMIT_HINT = "무료 워크스페이스를 더 만들 수 없습니다. 사용하지 않는 워크스페이스를 삭제해 주세요.";

type WorkspaceAction = "leave" | "delete";

/** 행 옵션 메뉴 상태. 역할은 메뉴를 열 때 멤버 목록으로 확인한다(워크스페이스 목록 응답에 역할이 없다). */
type RowMenu = WorkspaceMenuRole & {
  workspace: WorkspaceResponse;
  top: number;
  left: number;
};

const ACTION_COPY: Record<WorkspaceAction, { title: string; description: (name: string) => string; confirm: string; pending: string; failed: string }> = {
  leave: {
    title: "워크스페이스에서 탈퇴하시겠습니까?",
    description: (name) => `「${name}」에 더 이상 접근할 수 없습니다. 다시 참여하려면 초대가 필요합니다.`,
    confirm: "탈퇴",
    pending: "워크스페이스 탈퇴 중…",
    failed: "워크스페이스에서 탈퇴하지 못했습니다."
  },
  delete: {
    title: "워크스페이스를 삭제하시겠습니까?",
    description: (name) => `「${name}」 워크스페이스와 모든 문서·위키·채팅이 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`,
    confirm: "삭제",
    pending: "워크스페이스 삭제 중…",
    failed: "워크스페이스를 삭제하지 못했습니다."
  }
};

/**
 * 사이드바 상단 바 왼쪽 워크스페이스 전환 버튼 (Figma 1527:16277: 28px 첫 글자 상자 + 이름 + 셰브론).
 * 누르면 아래로 워크스페이스 전환 메뉴를 연다. 진행 중 작업 팝오버는 WikiWorkButton으로 옮겼다.
 * 사이드바를 접으면 보이지 않는다(Figma 1540:18686: 접힌 레일에는 워크스페이스 버튼이 없다).
 */
export function SidebarWorkspaceHeader() {
  const selectedWorkspace = useSelectedWorkspace();
  const name = selectedWorkspace?.name ?? "워크스페이스";
  const [isOpen, setIsOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateLimitReached, setIsCreateLimitReached] = useState(false);
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null);
  const [pendingAction, setPendingAction] = useState<{ workspace: WorkspaceResponse; action: WorkspaceAction } | null>(null);
  const [runningAction, setRunningAction] = useState<WorkspaceAction | null>(null);
  const { data: me } = useMe();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useDismissOnOutside(rootRef, isOpen, () => setIsOpen(false));

  useEffect(() => {
    if (!isOpen) setRowMenu(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    fetchWorkspaces()
      .then((response) => {
        if (cancelled) return;
        setWorkspaces(response.workspaces ?? []);
        setIsCreateLimitReached(isFreeWorkspaceLimitReached(response.free_workspace_count, response.free_workspace_limit));
        setLoadErrorMessage(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadErrorMessage(getErrorMessage(error, "워크스페이스를 불러오지 못했습니다."));
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  async function handleCreateWorkspace() {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const workspace = await createWorkspace("새 워크스페이스");
      switchWorkspace(workspace.id);
    } catch (error: unknown) {
      setLoadErrorMessage(describeLimitError(error) ?? getErrorMessage(error, "워크스페이스 생성에 실패했습니다."));
      setIsCreating(false);
    }
  }

  async function openRowMenu(workspace: WorkspaceResponse, anchor: HTMLElement) {
    // 본인 id가 있어야 역할을 판별할 수 있다. 로딩 중에는 옵션 버튼도 비활성이다.
    if (!me) return;
    if (rowMenu?.workspace.id === workspace.id) {
      setRowMenu(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const base = { workspace, top: rect.bottom + 4, left: rect.right - ROW_MENU_WIDTH };
    setRowMenu({ ...base, role: null, isLastOwner: false });
    try {
      const members = await fetchMembers(workspace.id);
      // 응답 사이 다른 행 메뉴로 바뀌었으면 덮어쓰지 않는다.
      setRowMenu((current) => current?.workspace.id === workspace.id
        ? { ...base, ...getWorkspaceMenuRole(members, me.id) }
        : current);
    } catch (error: unknown) {
      setRowMenu(null);
      setLoadErrorMessage(getErrorMessage(error, "워크스페이스 권한을 확인하지 못했습니다."));
    }
  }

  async function runAction() {
    if (!pendingAction || runningAction) return;
    const { workspace, action } = pendingAction;
    setPendingAction(null);
    setRunningAction(action);
    try {
      if (action === "delete") await deleteWorkspace(workspace.id);
      else if (me) await removeMember(workspace.id, me.id);
      else throw new Error("로그인 정보를 확인하지 못했습니다.");
      if (workspace.id === getSelectedWorkspaceId()) {
        clearSelectedWorkspaceId();
        window.location.assign("/workspaces");
        return;
      }
      setWorkspaces((current) => current.filter((item) => item.id !== workspace.id));
      // 무료 소유 수는 삭제·탈퇴한 워크스페이스의 역할·플랜에 따라 달라 서버 값으로 다시 맞춘다.
      // 다시 받지 못하면 지금 상태를 둔다. 메뉴를 다시 열면 새로 받고, 어긋나도 서버가 생성을 거절한다.
      fetchWorkspaces()
        .then((response) => setIsCreateLimitReached(isFreeWorkspaceLimitReached(response.free_workspace_count, response.free_workspace_limit)))
        .catch(() => {});
    } catch (error: unknown) {
      setIsOpen(true);
      setLoadErrorMessage(getErrorMessage(error, ACTION_COPY[action].failed));
    }
    setRunningAction(null);
  }

  const pendingCopy = pendingAction ? ACTION_COPY[pendingAction.action] : null;

  return (
    <div className={styles["sidebar-workspace"]} ref={rootRef}>
      {isCreating && <LoadingOverlay message="워크스페이스 생성 중…" />}
      {runningAction && <LoadingOverlay message={ACTION_COPY[runningAction].pending} />}
      {/* 말풍선은 아래로 띄우고, 드롭다운이 열려 있으면 숨긴다. */}
      <Tooltip content="워크스페이스 전환" placement="bottom" disabled={isOpen} describe={false}>
        <button
          type="button"
          className={styles["sidebar-workspace-trigger"]}
          aria-label={`워크스페이스 전환 (${name})`}
          aria-expanded={isOpen}
          onClick={(event) => {
            event.stopPropagation();
            setIsOpen((open) => !open);
          }}
        >
          <WorkspaceIcon workspace={selectedWorkspace} className={styles["sidebar-workspace-mark"]} hideEmoji />
          <span className={styles["sidebar-workspace-label"]}>
            <span className={styles["sidebar-workspace-name"]}>{name}</span>
            <SidebarWorkspaceChevronIcon className={styles["sidebar-workspace-chevron"]} />
          </span>
        </button>
      </Tooltip>

      {isOpen && (
        <div className={styles["workspace-dropdown"]}>
          {loadErrorMessage ? (
            <p className={styles["workspace-dropdown-error"]} role="alert">{loadErrorMessage}</p>
          ) : (
            <div className={styles["workspace-dropdown-list"]}>
              {workspaces.map((workspace) => (
                <div key={workspace.id} className={styles["workspace-dropdown-row"]}>
                  <button
                    type="button"
                    className={styles["workspace-dropdown-item"]}
                    onClick={() => {
                      setIsOpen(false);
                      switchWorkspace(workspace.id);
                    }}
                  >
                    <WorkspaceIcon workspace={workspace} className={styles["workspace-dropdown-avatar"]} />
                    <span className={styles["workspace-dropdown-label"]}>{workspace.name}</span>
                  </button>
                  <button
                    type="button"
                    className={styles["workspace-dropdown-more"]}
                    aria-label={`${workspace.name} 옵션`}
                    aria-expanded={rowMenu?.workspace.id === workspace.id}
                    disabled={!me}
                    onClick={(event) => void openRowMenu(workspace, event.currentTarget)}
                  >
                    <MoreVertical size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className={styles["workspace-dropdown-new"]}
            onClick={handleCreateWorkspace}
            disabled={isCreating || isCreateLimitReached}
            title={isCreateLimitReached ? FREE_WORKSPACE_LIMIT_HINT : undefined}
          >
            <Plus size={12} />새 워크스페이스
          </button>
        </div>
      )}

      {rowMenu && createPortal(
        <div
          className={styles["workspace-dropdown-menu-list"]}
          role="menu"
          style={{ top: rowMenu.top, left: rowMenu.left }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className={styles["is-danger"]}
            disabled={!canLeaveWorkspace(rowMenu)}
            title={rowMenu.role === null ? "권한 확인 중…" : rowMenu.isLastOwner ? "다른 OWNER를 지정한 뒤 탈퇴할 수 있습니다." : undefined}
            onClick={() => {
              setPendingAction({ workspace: rowMenu.workspace, action: "leave" });
              setRowMenu(null);
            }}
          >
            탈퇴
          </button>
          {rowMenu.role === "OWNER" && (
            <button
              type="button"
              role="menuitem"
              className={styles["is-danger"]}
              onClick={() => {
                setPendingAction({ workspace: rowMenu.workspace, action: "delete" });
                setRowMenu(null);
              }}
            >
              삭제
            </button>
          )}
        </div>,
        document.body
      )}

      {/* 사이드바 스태킹 컨텍스트에 가려지지 않도록 경고창은 body로 portal한다. */}
      {pendingAction && pendingCopy && createPortal(
        <ConfirmModal
          titleId="workspace-action-confirm-title"
          title={pendingCopy.title}
          description={pendingCopy.description(pendingAction.workspace.name)}
          confirmLabel={pendingCopy.confirm}
          tone="danger"
          onConfirm={() => void runAction()}
          onCancel={() => setPendingAction(null)}
        />,
        document.body
      )}
    </div>
  );
}
