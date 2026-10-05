import { MoreVertical, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listIcon, SvgIcon, toggleIcon } from "@/shared/ui/SvgIcon";
import { useSelectedWorkspace } from "@/entities/workspace/model/useWorkspaceName";
import { WorkspaceIcon } from "@/entities/workspace/ui/WorkspaceIcon";
import { createWorkspace, deleteWorkspace, fetchWorkspaces } from "@/entities/workspace";
import { fetchMembers, removeMember } from "@/entities/workspace/api/members";
import { useMe } from "@/entities/user";
import { clearSelectedWorkspaceId, getSelectedWorkspaceId, setSelectedWorkspaceId } from "@/shared/lib/auth";
import { useDismissOnOutside } from "@/shared/lib/useDismissOnOutside";
import { getErrorMessage } from "@/shared/lib/errors";
import { LoadingOverlay } from "@/shared/ui/LoadingOverlay";
import { ConfirmModal } from "@/shared/ui/ConfirmModal";
import type { WorkspaceResponse } from "@/entities/workspace";
import { cx } from "@/shared/lib/classNames";
import type { DocumentItemResponse } from "@/entities/document/model/document";
import { WikiWorkPopover } from "./WikiWorkPopover";
import { HoverHint } from "@/shared/ui/HoverHint";
import styles from "./DocumentSidebar.module.css";

/** 선택한 워크스페이스로 전환하고 화면을 새로 그린다 */
function switchWorkspace(workspaceId: string) {
  setSelectedWorkspaceId(workspaceId);
  window.location.reload();
}

// 행 옵션 메뉴 너비. 채팅 세션 메뉴(.chat-session-menu-list)와 같다.
const ROW_MENU_WIDTH = 132;

type WorkspaceAction = "leave" | "delete";

/** 행 옵션 메뉴 상태. 역할은 메뉴를 열 때 멤버 목록으로 확인한다(워크스페이스 목록 응답에 역할이 없다). */
type RowMenu = {
  workspace: WorkspaceResponse;
  top: number;
  left: number;
  role: "OWNER" | "MEMBER" | null;
  isLastOwner: boolean;
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
 * 사이드바 상단 워크스페이스 헤더 (Figma 1131:7125).
 * 이름을 클릭하면 워크스페이스 전환 메뉴, 오른쪽 목록 버튼을 클릭하면 진행 중 작업 팝오버를 연다.
 * 두 메뉴는 동시에 열리지 않는다.
 */
export function SidebarWorkspaceHeader({ documents = [] }: { documents?: DocumentItemResponse[] }) {
  const selectedWorkspace = useSelectedWorkspace();
  const name = selectedWorkspace?.name ?? "워크스페이스";
  const [isOpen, setIsOpen] = useState(false);
  const [isWorkOpen, setIsWorkOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null);
  const [pendingAction, setPendingAction] = useState<{ workspace: WorkspaceResponse; action: WorkspaceAction } | null>(null);
  const [runningAction, setRunningAction] = useState<WorkspaceAction | null>(null);
  const { data: me } = useMe();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useDismissOnOutside(rootRef, isOpen, () => setIsOpen(false));
  useDismissOnOutside(rootRef, isWorkOpen, () => setIsWorkOpen(false));

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
      setLoadErrorMessage(getErrorMessage(error, "워크스페이스 생성에 실패했습니다."));
      setIsCreating(false);
    }
  }

  async function openRowMenu(workspace: WorkspaceResponse, anchor: HTMLElement) {
    if (rowMenu?.workspace.id === workspace.id) {
      setRowMenu(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const base = { workspace, top: rect.bottom + 4, left: rect.right - ROW_MENU_WIDTH };
    setRowMenu({ ...base, role: null, isLastOwner: false });
    try {
      const members = await fetchMembers(workspace.id);
      const role = members.find((member) => member.user_id === me?.id)?.role ?? null;
      const ownerCount = members.filter((member) => member.role === "OWNER").length;
      // 응답 사이 다른 행 메뉴로 바뀌었으면 덮어쓰지 않는다.
      setRowMenu((current) => current?.workspace.id === workspace.id
        ? { ...base, role, isLastOwner: role === "OWNER" && ownerCount <= 1 }
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
      <button
        type="button"
        className={styles["sidebar-workspace-trigger"]}
        aria-label="워크스페이스 전환"
        aria-expanded={isOpen}
        onClick={() => {
          setIsWorkOpen(false);
          setIsOpen((open) => !open);
        }}
      >
        <WorkspaceIcon workspace={selectedWorkspace} className={styles["sidebar-workspace-mark"]} />
        <span className={styles["sidebar-workspace-name"]}>
          <span>{name}</span>
          <SvgIcon src={toggleIcon} className={cx(styles["sidebar-workspace-toggle"], isOpen && styles["is-open"])} />
        </span>
      </button>

      <HoverHint placement="bottom" align="end" className={styles["wiki-work-trigger-hint"]} text="진행 중인 AI 작업(위키 편입·위키 최신화·PDF→MD 변환)을 확인합니다.">
      <button
        type="button"
        className={styles["wiki-work-trigger"]}
        aria-label="진행 중인 작업"
        aria-expanded={isWorkOpen}
        onClick={() => {
          setIsOpen(false);
          setIsWorkOpen((open) => !open);
        }}
      >
        <SvgIcon src={listIcon} className={styles["wiki-work-icon"]} />
      </button>
      </HoverHint>
      {isWorkOpen && <WikiWorkPopover documents={documents} />}

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
            disabled={isCreating}
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
            disabled={rowMenu.role === null || rowMenu.isLastOwner}
            title={rowMenu.isLastOwner ? "다른 OWNER를 지정한 뒤 탈퇴할 수 있습니다." : undefined}
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
