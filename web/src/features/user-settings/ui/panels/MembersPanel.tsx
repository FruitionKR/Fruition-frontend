"use client";

import { useState } from "react";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserAvatar, useMe } from "@/entities/user";
import { changeMemberRole, fetchMembers, removeMember, updateMemberPermissions, type WorkspaceMember, type WorkspaceRole } from "@/entities/workspace/api/members";
import checkboxCheckIcon from "@/shared/assets/svg/settings/checkbox-check.svg";
import chevronDownIcon from "@/shared/assets/svg/settings/chevron-down.svg";
import memberAvatarIcon from "@/shared/assets/svg/settings/member-avatar.svg";
import memberSearchIcon from "@/shared/assets/svg/settings/member-search.svg";
import moreDotsIcon from "@/shared/assets/svg/settings/more-dots.svg";
import sortVerticalIcon from "@/shared/assets/svg/settings/sort-vertical.svg";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { cx } from "@/shared/lib/classNames";
import { WORKSPACE_PERMISSIONS, workspacePermissionLabel, type WorkspacePermission } from "@/shared/lib/workspacePermissions";
import { useDismissableMenu } from "@/shared/hooks/useDismissableMenu";
import { OptionSelect } from "@/shared/ui/OptionSelect";
import { excludeMember, memberDisplayName, selectVisibleMembers, type MemberRoleFilter, type MemberSortDirection } from "../../lib/memberList";
import modalStyles from "../SettingsModal.module.css";
import { InviteMemberModal } from "../modals/InviteMemberModal";
import styles from "./MembersPanel.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";

// 권한 필터 순서. 빈 값은 전체.
const ROLE_FILTERS: readonly MemberRoleFilter[] = ["", "OWNER", "MEMBER"];
const ROLE_FILTER_LABELS: Record<MemberRoleFilter, string> = { "": "전체", OWNER: "OWNER", MEMBER: "MEMBER" };
// 행 권한 목록 (Figma 1610:9350)
const ROLE_OPTIONS: ReadonlyArray<{ value: WorkspaceRole; label: string }> = [
  { value: "OWNER", label: "OWNER" },
  { value: "MEMBER", label: "MEMBER" }
];

/** 행 앞 체크 칸 (Figma Check off 1482:10965). 일괄 작업이 없어 표시만 한다. */
function RowCheck() {
  return (
    <span className={styles.checkbox} aria-hidden>
      <Image src={checkboxCheckIcon} alt="" />
    </span>
  );
}

/**
 * 멤버 관리 (Figma 1540:21567, 초대 모달 1708:5341).
 * 총 인원 · 검색 · 권한 필터 · 멤버 초대하기 + 사용자/사용 권한 표. 본인은 표와 총 인원에서 빼고 초대한 다른 멤버만 보인다.
 * 권한 항목(위키 편입 등, access #32)은 시안 표에 열이 없어 행 끝 "…" 메뉴로 옮겼다.
 */
export function MembersPanel() {
  const { data: me, isPending: isMePending } = useMe();
  const queryClient = useQueryClient();
  const workspaceId = getSelectedWorkspaceId();
  const queryKey = ["workspace-members", workspaceId];
  const { data: members = [], isPending, error: loadError } = useQuery({
    queryKey,
    queryFn: () => fetchMembers(workspaceId!),
    enabled: Boolean(workspaceId),
    retry: false
  });
  const [filter, setFilter] = useState<MemberRoleFilter>("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortDirection, setSortDirection] = useState<MemberSortDirection>("asc");
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
  // 본인 판별(user_id) 전에는 본인이 섞여 보이지 않게 비워 두고 불러오는 중으로 둔다. 마지막 OWNER 판별(ownerCount)은 본인을 포함한 전체로 한다.
  const otherMembers = me ? excludeMember(members, me.id) : [];
  const isListPending = isPending || isMePending;
  const visibleMembers = selectVisibleMembers(otherMembers, { roleFilter: filter, search, sortDirection });

  function replaceMember(updated: WorkspaceMember) {
    queryClient.setQueryData<WorkspaceMember[]>(queryKey, (current) => current?.map((item) => item.user_id === updated.user_id ? updated : item));
  }

  async function run(action: () => Promise<void>, done: string, fallback: string) {
    if (!workspaceId || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(done);
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, fallback));
    } finally {
      setBusy(false);
    }
  }

  function changeRole(member: WorkspaceMember, role: WorkspaceRole) {
    if (!isOwner || role === member.role) return;
    void run(async () => replaceMember(await changeMemberRole(workspaceId!, member.user_id, role)),
      "멤버 권한을 변경했습니다.", "멤버 권한을 변경하지 못했습니다.");
  }

  // 권한 항목 하나를 켜거나 끈다. 서버는 목록 전체를 교체하므로 현재 목록에서 더하거나 뺀 전체를 보낸다(access #32).
  function togglePermission(member: WorkspaceMember, permission: WorkspacePermission) {
    if (!isOwner || member.role === "OWNER") return;
    const next = member.permissions.includes(permission)
      ? member.permissions.filter((item) => item !== permission)
      : [...member.permissions, permission];
    void run(async () => replaceMember(await updateMemberPermissions(workspaceId!, member.user_id, next)),
      "멤버 권한 항목을 변경했습니다.", "멤버 권한 항목을 변경하지 못했습니다.");
  }

  function remove(member: WorkspaceMember) {
    setOpenMenuId(null);
    if (!window.confirm(memberDisplayName(member) + " 님을 워크스페이스에서 제거하시겠습니까?")) return;
    void run(async () => {
      await removeMember(workspaceId!, member.user_id);
      queryClient.setQueryData<WorkspaceMember[]>(queryKey, (current) => current?.filter((item) => item.user_id !== member.user_id));
    }, "멤버를 제거했습니다.", "멤버를 제거하지 못했습니다.");
  }

  return (
    <div className={modalStyles.detail}>
      <SettingsPanelTitle title="멤버 관리" description="워크스페이스에 있는 사람과 역할을 관리합니다." />
      <div className={styles.list}>
        <div className={styles.toolbar}>
          <p className={styles.total}>
            총 <strong>{otherMembers.length}</strong>명
          </p>
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
              className={styles["icon-btn"]}
              aria-label="멤버 검색"
              aria-expanded={searchOpen || Boolean(search)}
              onClick={() => setSearchOpen(true)}
            >
              <Image src={memberSearchIcon} alt="" aria-hidden />
            </button>
            <div className={styles["filter-wrap"]} ref={filterMenuRef}>
              <button type="button" className={styles["filter-btn"]} aria-haspopup="listbox" aria-expanded={filterOpen}
                onClick={() => setFilterOpen(!filterOpen)}>
                {filter ? <span className={styles["filter-accent"]}>권한 : {filter}</span> : "권한"}
                <Image src={chevronDownIcon} alt="" aria-hidden />
              </button>
              {filterOpen && (
                <div className={styles["filter-menu"]} role="listbox" aria-label="권한 필터">
                  {ROLE_FILTERS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="option"
                      aria-selected={filter === option}
                      className={cx(styles["menu-option"], filter === option && styles["is-selected"])}
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
              멤버 초대하기
            </button>
          </div>
        </div>

        {(!workspaceId || error || loadError) && <p className={modalStyles["field-error"]} role="alert">{!workspaceId ? "워크스페이스를 선택해 주세요." : error || getErrorMessage(loadError, "멤버 목록을 불러오지 못했습니다.")}</p>}
        {message && <p className={styles.note} role="status">{message}</p>}
        {myMembership && !isOwner && (
          <p className={styles.note}>
            내 권한 항목:{" "}
            {myMembership.permissions.length > 0
              ? myMembership.permissions.map(workspacePermissionLabel).join(", ")
              : "없음. 필요한 권한은 워크스페이스 OWNER에게 요청하세요."}
          </p>
        )}

        <div className={styles.table}>
          <div className={cx(styles.row, styles["row-head"])}>
            <div className={styles["cell-user"]}>
              <RowCheck />
              <button type="button" className={styles["sort-btn"]}
                aria-label={`사용자 이름 ${sortDirection === "asc" ? "내림차순" : "오름차순"}으로 정렬`}
                onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")}>
                사용자
                <Image src={sortVerticalIcon} alt="" aria-hidden />
              </button>
            </div>
            <span className={styles["cell-role"]}>사용 권한</span>
            <span className={styles["cell-more"]} aria-hidden />
          </div>
          {isListPending && workspaceId && <p className={styles.empty} role="status">멤버를 불러오는 중…</p>}
          {!isListPending && !loadError && visibleMembers.length === 0 && (
            <p className={styles.empty}>{otherMembers.length === 0 ? "아직 초대한 멤버가 없습니다." : "표시할 멤버가 없습니다."}</p>
          )}
          {visibleMembers.map((member) => {
            const name = memberDisplayName(member);
            const lastOwner = member.role === "OWNER" && ownerCount <= 1;
            const isMenuOpen = openMenuId === member.user_id;
            return (
              <div className={styles.row} key={member.user_id}>
                <div className={styles["cell-user"]}>
                  <RowCheck />
                  <div className={styles.profile}>
                    {member.avatar_url
                      ? <UserAvatar avatarUrl={member.avatar_url} name={name} className={styles["profile-icon"]} />
                      : <Image src={memberAvatarIcon} alt="" aria-hidden className={styles["profile-icon"]} />}
                    <div className={styles["profile-text"]}>
                      <span className={styles["profile-name"]}>{member.display_name || "사용자"}</span>
                      <span className={styles["profile-email"]}>{member.email}</span>
                    </div>
                  </div>
                </div>
                <div className={styles["cell-role"]}>
                  <OptionSelect
                    value={member.role}
                    placeholder="권한"
                    options={ROLE_OPTIONS}
                    ariaLabel={`${name} 권한: ${member.role}`}
                    disabled={!isOwner || busy || lastOwner}
                    title={lastOwner ? "마지막 OWNER의 권한은 변경할 수 없습니다." : undefined}
                    floating
                    onChange={(value) => changeRole(member, value as WorkspaceRole)}
                  />
                </div>
                <div className={styles["cell-more"]} ref={isMenuOpen ? rowMenuRef : undefined}>
                  <button type="button" className={styles["more-btn"]} aria-label={`${name} 더보기`} aria-haspopup="menu"
                    aria-expanded={isMenuOpen} onClick={() => setOpenMenuId(isMenuOpen ? null : member.user_id)}>
                    <Image src={moreDotsIcon} alt="" aria-hidden />
                  </button>
                  {isMenuOpen && (
                    <div className={styles["more-menu"]} role="menu" aria-label={`${name} 메뉴`}>
                      <p className={styles["menu-label"]}>권한 항목</p>
                      {WORKSPACE_PERMISSIONS.map((item) => {
                        // OWNER는 항상 전부 가지므로 켜진 채 잠근다(서버도 OWNER_PERMISSIONS_FIXED로 거절한다).
                        const isMemberOwner = member.role === "OWNER";
                        const checked = isMemberOwner || member.permissions.includes(item.value);
                        return (
                          <button
                            key={item.value}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={checked}
                            className={cx(styles["menu-option"], styles["perm-option"], checked && styles["is-on"])}
                            // 저장 중에는 disabled 대신 aria-disabled로 막는다. disabled로 바꾸면 누른 항목의 포커스가 body로 빠진다.
                            disabled={!isOwner || isMemberOwner}
                            aria-disabled={busy || undefined}
                            title={isMemberOwner ? "OWNER는 모든 권한을 가집니다." : item.description}
                            onClick={() => togglePermission(member, item.value)}
                          >
                            <span>{item.label}</span>
                            <span className={styles["perm-state"]}>{checked ? "켜짐" : "꺼짐"}</span>
                          </button>
                        );
                      })}
                      {isOwner && (
                        <button
                          type="button"
                          role="menuitem"
                          className={cx(styles["menu-option"], styles["is-danger"])}
                          disabled={lastOwner || busy}
                          title={lastOwner ? "마지막 OWNER는 제거할 수 없습니다." : undefined}
                          onClick={() => remove(member)}
                        >
                          멤버 제거
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
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
    </div>
  );
}
