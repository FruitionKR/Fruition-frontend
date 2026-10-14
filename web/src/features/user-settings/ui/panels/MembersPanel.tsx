"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserAvatar, useMe } from "@/entities/user";
import { changeMemberRole, fetchMembers, removeMember, updateMemberPermissions, type WorkspaceMember, type WorkspaceRole } from "@/entities/workspace/api/members";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { WORKSPACE_PERMISSIONS, workspacePermissionLabel, type WorkspacePermission } from "@/shared/lib/workspacePermissions";
import { useDismissableMenu } from "@/shared/hooks/useDismissableMenu";
import { menuSearchIcon, moreIcon, chevronDownSmallIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import modalStyles from "../SettingsModal.module.css";
import { InviteMemberModal } from "../modals/InviteMemberModal";
import styles from "./MembersPanel.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";

// 권한 필터 순서. 빈 값은 전체.
const ROLE_FILTERS = ["", "OWNER", "MEMBER"] as const;
type RoleFilter = (typeof ROLE_FILTERS)[number];
const ROLE_FILTER_LABELS: Record<RoleFilter, string> = { "": "전체", OWNER: "OWNER", MEMBER: "MEMBER" };

/** 멤버 관리 패널 (Figma 987:10705). */
export function MembersPanel() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const workspaceId = getSelectedWorkspaceId();
  const queryKey = ["workspace-members", workspaceId];
  const { data: members = [], isPending, error: loadError } = useQuery({
    queryKey,
    queryFn: () => fetchMembers(workspaceId!),
    enabled: Boolean(workspaceId),
    retry: false
  });
  const [filter, setFilter] = useState<RoleFilter>("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // 행 우측 "…" 메뉴가 열린 멤버 id (한 번에 하나만)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // 필터·행 메뉴는 바깥 클릭이나 Escape로 닫는다. 행 메뉴 ref는 열린 행에만 붙인다.
  const filterMenuRef = useDismissableMenu(filterOpen, () => setFilterOpen(false));
  const rowMenuRef = useDismissableMenu(openMenuId !== null, () => setOpenMenuId(null));
  const [showInvite, setShowInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const myMembership = members.find((member) => member.user_id === me?.id);
  const isOwner = myMembership?.role === "OWNER";
  const ownerCount = members.filter((member) => member.role === "OWNER").length;
  // 로그인한 본인은 목록에서 제외하고, 워크스페이스에 추가한 사용자만 보여준다.
  const visibleMembers = members.filter((member) =>
    member.user_id !== me?.id &&
    (!filter || member.role === filter) &&
    ((member.display_name ?? "") + " " + member.email).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );

  async function changeRole(member: WorkspaceMember, role: WorkspaceRole) {
    if (!workspaceId || busy || !isOwner || role === member.role) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await changeMemberRole(workspaceId, member.user_id, role);
      queryClient.setQueryData<WorkspaceMember[]>(queryKey, (current) => current?.map((item) => item.user_id === updated.user_id ? updated : item));
      setMessage("멤버 권한을 변경했습니다.");
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "멤버 권한을 변경하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  // 권한 항목 하나를 켜거나 끈다. 서버는 목록 전체를 교체하므로 현재 목록에서 더하거나 뺀 전체를 보낸다(access #32).
  async function togglePermission(member: WorkspaceMember, permission: WorkspacePermission) {
    if (!workspaceId || busy || !isOwner || member.role === "OWNER") return;
    const next = member.permissions.includes(permission)
      ? member.permissions.filter((item) => item !== permission)
      : [...member.permissions, permission];
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateMemberPermissions(workspaceId, member.user_id, next);
      queryClient.setQueryData<WorkspaceMember[]>(queryKey, (current) => current?.map((item) => item.user_id === updated.user_id ? updated : item));
      setMessage("멤버 권한 항목을 변경했습니다.");
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "멤버 권한 항목을 변경하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: WorkspaceMember) {
    if (!workspaceId || busy) return;
    setOpenMenuId(null);
    if (!window.confirm((member.display_name || member.email) + " 님을 워크스페이스에서 제거하시겠습니까?")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await removeMember(workspaceId, member.user_id);
      queryClient.setQueryData<WorkspaceMember[]>(queryKey, (current) => current?.filter((item) => item.user_id !== member.user_id));
      setMessage("멤버를 제거했습니다.");
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "멤버를 제거하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={modalStyles.detail}>
      <SettingsPanelTitle title="멤버 관리" description="워크스페이스에 있는 사람과 역할을 관리합니다." />
      <div className={styles.toolbar}>
        <div className={styles["filter-wrap"]} ref={filterMenuRef}>
          <button
            type="button"
            className={styles["filter-btn"]}
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen(!filterOpen)}
          >
            {filter ? <span className={styles["filter-accent"]}>권한 : {filter}</span> : "권한"}
            <SvgIcon src={chevronDownSmallIcon} className={styles["chev-icon"]} />
          </button>
          {filterOpen && (
            <div className={styles["filter-menu"]} role="listbox" aria-label="권한 필터">
              {ROLE_FILTERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={filter === option}
                  className={`${styles["filter-option"]} ${filter === option ? styles["is-selected"] : ""}`}
                  onClick={() => {
                    setFilter(option);
                    setFilterOpen(false);
                  }}
                >
                  {ROLE_FILTER_LABELS[option]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={styles["toolbar-group"]}>
          {(searchOpen || search) && (
            <input
              type="search"
              className={styles["search-input"]}
              aria-label="멤버 검색"
              placeholder="이름 또는 이메일 검색"
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onBlur={() => { if (!search) setSearchOpen(false); }}
            />
          )}
          <button
            type="button"
            className={styles["search-btn"]}
            aria-label="멤버 검색"
            aria-expanded={searchOpen || Boolean(search)}
            onClick={() => setSearchOpen(true)}
          >
            <SvgIcon src={menuSearchIcon} className={styles["search-icon"]} />
          </button>
          <button
            type="button"
            className={styles["invite-btn"]}
            disabled={!isOwner || busy}
            aria-haspopup="dialog"
            onClick={() => {
              setError(null);
              setMessage(null);
              setShowInvite(true);
            }}
          >
            멤버 추가하기
          </button>
        </div>
      </div>
      {showInvite && isOwner && workspaceId && (
        <InviteMemberModal
          workspaceId={workspaceId}
          onInvited={(text) => {
            setMessage(text);
            setShowInvite(false);
          }}
          onClose={() => setShowInvite(false)}
        />
      )}
      {(!workspaceId || error || loadError) && <p className={modalStyles["model-error"]} role="alert">{!workspaceId ? "워크스페이스를 선택해 주세요." : error || getErrorMessage(loadError, "멤버 목록을 불러오지 못했습니다.")}</p>}
      {message && <p role="status">{message}</p>}
      {myMembership && (
        <p className={styles["my-permissions"]}>
          내 권한 항목:{" "}
          {isOwner
            ? "모든 권한 (OWNER)"
            : myMembership.permissions.length > 0
              ? myMembership.permissions.map(workspacePermissionLabel).join(", ")
              : "없음. 필요한 권한은 워크스페이스 OWNER에게 요청하세요."}
        </p>
      )}
      {isPending && workspaceId && <p role="status">멤버를 불러오는 중…</p>}
      {!isPending && !loadError && visibleMembers.length === 0 && <p>표시할 멤버가 없습니다.</p>}
      <div className={styles.table}>
        <div className={styles.row + " " + styles["row-head"]}>
          <span className={styles.checkbox} aria-hidden />
          <div className={styles["row-main"]}><span>사용자</span><span className={styles["cell-role"]}>사용 권한</span></div>
          <span className={styles["cell-permissions"]}>권한 항목</span>
        </div>
        {visibleMembers.map((member) => {
          const lastOwner = member.role === "OWNER" && ownerCount <= 1;
          return (
            <div className={styles.row} key={member.user_id}>
              <span className={styles.checkbox} aria-hidden />
              <div className={styles["row-main"]}>
                <div className={styles.profile}>
                  <UserAvatar avatarUrl={member.avatar_url} name={member.display_name || member.email} className={styles["profile-icon"]} />
                  <div className={styles["profile-text"]}>
                    <span className={styles["profile-name"]}>{member.display_name || "사용자"}</span>
                    <span className={styles["profile-email"]}>{member.email}</span>
                  </div>
                </div>
                <span className={styles["cell-role"]}>
                  <span className={styles["role-chip"]}>
                    <select className={styles["role-select"]} aria-label={(member.display_name || member.email) + " 권한"} value={member.role} disabled={!isOwner || busy || lastOwner} title={lastOwner ? "마지막 OWNER의 권한은 변경할 수 없습니다." : undefined} onChange={(event) => void changeRole(member, event.target.value as WorkspaceRole)}>
                      <option value="OWNER">OWNER</option><option value="MEMBER">MEMBER</option>
                    </select>
                    <SvgIcon src={chevronDownSmallIcon} className={styles["chev-icon"]} />
                  </span>
                </span>
              </div>
              <div className={styles["cell-permissions"]} role="group" aria-label={(member.display_name || member.email) + " 권한 항목"}>
                {WORKSPACE_PERMISSIONS.map((item) => {
                  // OWNER는 항상 전부 가지므로 켜진 채 잠근다(서버도 OWNER_PERMISSIONS_FIXED로 거절한다).
                  const isMemberOwner = member.role === "OWNER";
                  const checked = isMemberOwner || member.permissions.includes(item.value);
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      className={`${styles["perm-chip"]} ${checked ? styles["is-on"] : ""}`}
                      // 저장 중에는 disabled 대신 aria-disabled로 막는다. disabled로 바꾸면 누른 칩의 포커스가 body로 빠져
                      // 키보드 사용자가 매번 처음부터 다시 Tab해야 한다. 중복 요청은 togglePermission의 busy 검사가 막는다.
                      disabled={!isOwner || isMemberOwner}
                      aria-disabled={busy || undefined}
                      title={isMemberOwner ? "OWNER는 모든 권한을 가집니다." : item.description}
                      onClick={() => void togglePermission(member, item.value)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              {isOwner && (
                <div className={styles["more-wrap"]} ref={openMenuId === member.user_id ? rowMenuRef : undefined}>
                  <button
                    type="button"
                    className={styles["more-btn"]}
                    aria-label={(member.display_name || member.email) + " 더보기"}
                    aria-expanded={openMenuId === member.user_id}
                    disabled={busy}
                    onClick={() => setOpenMenuId(openMenuId === member.user_id ? null : member.user_id)}
                  >
                    <SvgIcon src={moreIcon} className={styles["more-icon"]} />
                  </button>
                  {openMenuId === member.user_id && (
                    <div className={styles["more-menu"]} role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className={styles["filter-option"]}
                        disabled={lastOwner}
                        title={lastOwner ? "마지막 OWNER는 제거할 수 없습니다." : undefined}
                        onClick={() => void remove(member)}
                      >
                        멤버 제거
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
