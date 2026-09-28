"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/entities/user";
import { changeMemberRole, fetchMembers, inviteMember, removeMember, type WorkspaceMember, type WorkspaceRole } from "@/entities/workspace/api/members";
import { clearSelectedWorkspaceId, getSelectedWorkspaceId } from "@/shared/lib/auth";
import { getErrorMessage } from "@/shared/lib/errors";
import { menuSearchIcon, moreIcon, settingScrollIcon, SvgIcon, userCircleIcon } from "@/shared/ui/SvgIcon";
import modalStyles from "../SettingsModal.module.css";
import styles from "./MembersPanel.module.css";

// 권한 필터 순서. 빈 값은 전체.
const ROLE_FILTERS = ["", "OWNER", "MEMBER"] as const;
type RoleFilter = (typeof ROLE_FILTERS)[number];
const ROLE_FILTER_LABELS: Record<RoleFilter, string> = { "": "전체", OWNER: "OWNER", MEMBER: "MEMBER" };

/** 멤버 관리 패널 (Figma 987:10705). */
export function MembersPanel({ onLeave }: { onLeave: () => void }) {
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
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("MEMBER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isOwner = members.find((member) => member.user_id === me?.id)?.role === "OWNER";
  const ownerCount = members.filter((member) => member.role === "OWNER").length;
  const visibleMembers = members.filter((member) =>
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
      // 자기 역할 변경은 다른 화면의 권한 표시에도 반영한다.
      if (member.user_id === me?.id) window.location.reload();
      setMessage("멤버 권한을 변경했습니다.");
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "멤버 권한을 변경하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: WorkspaceMember) {
    if (!workspaceId || busy) return;
    setOpenMenuId(null);
    const self = member.user_id === me?.id;
    if (!window.confirm(self ? "이 워크스페이스에서 탈퇴하시겠습니까?" : (member.display_name || member.email) + " 님을 워크스페이스에서 제거하시겠습니까?")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await removeMember(workspaceId, member.user_id);
      if (self) {
        clearSelectedWorkspaceId();
        queryClient.clear();
        onLeave();
        window.location.assign("/workspaces");
        return;
      }
      queryClient.setQueryData<WorkspaceMember[]>(queryKey, (current) => current?.filter((item) => item.user_id !== member.user_id));
      setMessage("멤버를 제거했습니다.");
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "멤버를 제거하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || !isOwner || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await inviteMember(workspaceId, email.trim(), inviteRole);
      setMessage("초대 메일을 보냈습니다. 상대가 수락하면 멤버 목록에 표시됩니다.");
      setEmail("");
      setShowInvite(false);
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "초대 메일을 보내지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={modalStyles.detail}>
      <div className={modalStyles.title}>
        <div className={modalStyles["title-row"]}><h2>멤버 관리</h2></div>
        <p>워크스페이스에 있는 사람과 역할을 관리합니다.</p>
      </div>
      <div className={styles.toolbar}>
        <div className={styles["filter-wrap"]}>
          <button
            type="button"
            className={styles["filter-btn"]}
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen(!filterOpen)}
          >
            {filter ? <span className={styles["filter-accent"]}>권한 : {filter}</span> : "권한"}
            <SvgIcon src={settingScrollIcon} className={styles["chev-icon"]} />
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
          <button type="button" className={styles["invite-btn"]} disabled={!isOwner || busy} aria-expanded={showInvite} onClick={() => setShowInvite(!showInvite)}>
            멤버 추가하기 <SvgIcon src={settingScrollIcon} className={styles["chev-icon"]} />
          </button>
        </div>
      </div>
      {showInvite && isOwner && (
        <form className={styles["invite-form"]} onSubmit={(event) => void invite(event)}>
          <div className={modalStyles.field}>
            <label htmlFor="invite-email">초대할 이메일</label>
            <input id="invite-email" type="email" maxLength={255} required value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <span className={styles["role-chip"]}>
            <select className={styles["role-select"]} aria-label="초대할 멤버 권한" value={inviteRole} disabled={busy} onChange={(event) => setInviteRole(event.target.value as WorkspaceRole)}>
              <option value="MEMBER">MEMBER</option><option value="OWNER">OWNER</option>
            </select>
            <SvgIcon src={settingScrollIcon} className={styles["chev-icon"]} />
          </span>
          <button type="submit" className={styles["invite-btn"]} disabled={busy}>{busy ? "전송 중…" : "초대 보내기"}</button>
        </form>
      )}
      {(!workspaceId || error || loadError) && <p className={modalStyles["model-error"]} role="alert">{!workspaceId ? "워크스페이스를 선택해 주세요." : error || getErrorMessage(loadError, "멤버 목록을 불러오지 못했습니다.")}</p>}
      {message && <p role="status">{message}</p>}
      {isPending && workspaceId && <p role="status">멤버를 불러오는 중…</p>}
      {!isPending && !loadError && visibleMembers.length === 0 && <p>표시할 멤버가 없습니다.</p>}
      <div className={styles.table}>
        <div className={styles.row + " " + styles["row-head"]}>
          <span className={styles.checkbox} aria-hidden />
          <div className={styles["row-main"]}><span>사용자</span><span className={styles["cell-role"]}>사용 권한</span></div>
        </div>
        {visibleMembers.map((member) => {
          const self = member.user_id === me?.id;
          const lastOwner = member.role === "OWNER" && ownerCount <= 1;
          const canRemove = isOwner || self;
          return (
            <div className={styles.row} key={member.user_id}>
              <span className={styles.checkbox} aria-hidden />
              <div className={styles["row-main"]}>
                <div className={styles.profile}>
                  <SvgIcon src={userCircleIcon} className={styles["profile-icon"]} />
                  <div className={styles["profile-text"]}>
                    <span className={styles["profile-name"]}>{member.display_name || "사용자"}{self ? " (나)" : ""}</span>
                    <span className={styles["profile-email"]}>{member.email}</span>
                  </div>
                </div>
                <span className={styles["cell-role"]}>
                  <span className={styles["role-chip"]}>
                    <select className={styles["role-select"]} aria-label={(member.display_name || member.email) + " 권한"} value={member.role} disabled={!isOwner || busy || lastOwner} title={lastOwner ? "마지막 OWNER의 권한은 변경할 수 없습니다." : undefined} onChange={(event) => void changeRole(member, event.target.value as WorkspaceRole)}>
                      <option value="OWNER">OWNER</option><option value="MEMBER">MEMBER</option>
                    </select>
                    <SvgIcon src={settingScrollIcon} className={styles["chev-icon"]} />
                  </span>
                </span>
              </div>
              {canRemove && (
                <div className={styles["more-wrap"]}>
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
                        title={lastOwner ? "다른 OWNER를 지정한 뒤 탈퇴할 수 있습니다." : undefined}
                        onClick={() => void remove(member)}
                      >
                        {self ? "워크스페이스 탈퇴" : "멤버 제거"}
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
