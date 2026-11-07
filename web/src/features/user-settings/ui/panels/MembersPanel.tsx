"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserAvatar, useMe } from "@/entities/user";
import { changeMemberRole, fetchMembers, removeMember, updateMemberPermissions, type WorkspaceMember, type WorkspaceRole } from "@/entities/workspace/api/members";
import checkOnIcon from "@/shared/assets/svg/agent/organize-check-on.svg";
import checkboxCheckIcon from "@/shared/assets/svg/settings/checkbox-check.svg";
import chevronDownIcon from "@/shared/assets/svg/settings/chevron-down.svg";
import memberAvatarIcon from "@/shared/assets/svg/settings/member-avatar.svg";
import memberSearchIcon from "@/shared/assets/svg/settings/member-search.svg";
import moreDotsIcon from "@/shared/assets/svg/settings/more-dots.svg";
import sortVerticalIcon from "@/shared/assets/svg/settings/sort-vertical.svg";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { cx } from "@/shared/lib/classNames";
import { localizedWorkspacePermissionLabel, localizedWorkspacePermissions, type WorkspacePermission } from "@/shared/lib/workspacePermissions";
import { useDismissableMenu } from "@/shared/hooks/useDismissableMenu";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";
import { OptionSelect } from "@/shared/ui/OptionSelect";
import {
  canRemoveMember, effectiveSelection, excludeMember, memberDisplayName, removalNotice, selectAllState, selectVisibleMembers,
  MEMBER_ROLE_OPTIONS, summarizeMemberNames, toggleAllSelection, toggleSelection, type MemberRoleFilter, type MemberSortDirection, type RemovalFailure, type RemovalNotice,
  type SelectAllState
} from "../../lib/memberList";
import modalStyles from "../SettingsModal.module.css";
import { InviteMemberModal } from "../modals/InviteMemberModal";
import styles from "./MembersPanel.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";

// 권한 필터 순서. 빈 값은 전체.
const ROLE_FILTERS: readonly MemberRoleFilter[] = ["", "OWNER", "MEMBER"];

/**
 * 삭제 대상을 고르는 체크 칸 (Figma Check off 1482:10965, 켜짐은 같은 시안의 primary 채운 체크).
 * 일부만 고른 머리 칸(mixed)은 시안에 없어 primary 바탕에 가로줄로 그린다.
 */
function SelectCheck({ checked, label, disabled, title, onToggle }: {
  checked: SelectAllState;
  label: string;
  disabled: boolean;
  title?: string;
  onToggle: () => void;
}) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} title={title}
      className={styles["check-btn"]} disabled={disabled} onClick={onToggle}>
      {checked === true
        ? <Image src={checkOnIcon} alt="" aria-hidden />
        : (
          <span className={cx(styles.checkbox, checked === "mixed" && styles["is-mixed"])} aria-hidden>
            {checked === false && <Image src={checkboxCheckIcon} alt="" />}
          </span>
        )}
    </button>
  );
}

/**
 * 멤버 관리 (Figma 1540:21567, 초대 모달 1708:5341).
 * 총 인원 · 검색 · 권한 필터 · 삭제 · 멤버 초대하기 + 사용자/사용 권한 표. 본인은 표와 총 인원에서 빼고 초대한 다른 멤버만 보인다.
 * 체크 칸으로 여러 멤버를 골라 툴바 삭제로 한 번에 지운다(OWNER만, 마지막 OWNER 제외). 행 "…" 메뉴의 멤버 삭제는 한 명만 지운다.
 * 권한 항목(위키 편입 등, access #32)은 시안 표에 열이 없어 행 끝 "…" 메뉴로 옮겼다.
 */
export function MembersPanel() {
  const t = useTranslations("settings.members");
  const tCommon = useTranslations("settings.common");
  const tShared = useTranslations("shared");
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
  // 삭제하려고 고른 멤버 id. 실제로 지울 대상은 보이는 삭제 가능 멤버와 겹치는 것만이다(effectiveSelection).
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  // 확인 모달에 올린 삭제 대상. 행 메뉴의 단건 삭제와 툴바의 선택 삭제가 같은 모달을 쓴다.
  const [removeTargets, setRemoveTargets] = useState<WorkspaceMember[] | null>(null);
  const myMembership = members.find((member) => member.user_id === me?.id);
  const isOwner = myMembership?.role === "OWNER";
  const ownerCount = members.filter((member) => member.role === "OWNER").length;
  // 본인 판별(user_id) 전에는 본인이 섞여 보이지 않게 비워 두고 불러오는 중으로 둔다. 마지막 OWNER 판별(ownerCount)은 본인을 포함한 전체로 한다.
  const otherMembers = me ? excludeMember(members, me.id) : [];
  const isListPending = isPending || isMePending;
  const visibleMembers = selectVisibleMembers(otherMembers, { roleFilter: filter, search, sortDirection });
  const removalScope = { isOwner, selfId: me?.id, ownerCount };
  const removableIds = visibleMembers.filter((member) => canRemoveMember(member, removalScope)).map((member) => member.user_id);
  const selection = effectiveSelection(removableIds, selectedIds);
  const headCheck = selectAllState(removableIds, selectedIds);

  /** 이름 목록 문구: 「a」, 「b」 외 N명 */
  function formatNames(names: readonly string[]) {
    const { shown, hiddenCount } = summarizeMemberNames(names);
    const listed = shown.map((name) => t("nameQuoted", { name })).join(", ");
    return hiddenCount > 0 ? t("namesMore", { names: listed, count: hiddenCount }) : listed;
  }

  function formatRemovalNotice(notice: RemovalNotice) {
    if (notice.ok) return t("removed", { count: notice.succeeded });
    const parts = [
      t("removalSummary", { succeeded: notice.succeeded, failed: notice.failed }),
      ...notice.shownFailures.map((failure) => t("removalFailure", { name: t("nameQuoted", { name: failure.name }), reason: failure.reason }))
    ];
    if (notice.hiddenFailures > 0) parts.push(t("removalMoreFailures", { count: notice.hiddenFailures }));
    return parts.join(" · ");
  }

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
      setError(getErrorMessage(cause, fallback, tShared));
    } finally {
      setBusy(false);
    }
  }

  function changeRole(member: WorkspaceMember, role: WorkspaceRole) {
    if (!isOwner || role === member.role) return;
    void run(async () => replaceMember(await changeMemberRole(workspaceId!, member.user_id, role)),
      t("roleChanged"), t("roleChangeFailed"));
  }

  // 권한 항목 하나를 켜거나 끈다. 서버는 목록 전체를 교체하므로 현재 목록에서 더하거나 뺀 전체를 보낸다(access #32).
  function togglePermission(member: WorkspaceMember, permission: WorkspacePermission) {
    if (!isOwner || member.role === "OWNER") return;
    const next = member.permissions.includes(permission)
      ? member.permissions.filter((item) => item !== permission)
      : [...member.permissions, permission];
    void run(async () => replaceMember(await updateMemberPermissions(workspaceId!, member.user_id, next)),
      t("permissionChanged"), t("permissionChangeFailed"));
  }

  function askRemove(targets: WorkspaceMember[]) {
    setOpenMenuId(null);
    if (!isOwner || busy || targets.length === 0) return;
    setRemoveTargets(targets);
  }

  // 한 명씩 차례로 지우고(일괄 엔드포인트가 없다) 결과를 한 번만 알린 뒤 목록을 한 번 다시 받는다.
  async function removeSelected(targets: WorkspaceMember[]) {
    setRemoveTargets(null);
    if (!workspaceId || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    let succeeded = 0;
    const failures: RemovalFailure[] = [];
    for (const member of targets) {
      try {
        await removeMember(workspaceId, member.user_id);
        succeeded += 1;
      } catch (cause: unknown) {
        failures.push({ name: memberDisplayName(member), reason: getErrorMessage(cause, t("removeFailed"), tShared) });
      }
    }
    const notice = removalNotice(succeeded, failures);
    if (notice.ok) setMessage(formatRemovalNotice(notice));
    else setError(formatRemovalNotice(notice));
    setSelectedIds(new Set());
    try {
      await queryClient.invalidateQueries({ queryKey });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={modalStyles.detail}>
      <SettingsPanelTitle title={t("title")} description={t("description")} />
      <div className={styles.list}>
        <div className={styles.toolbar}>
          <p className={styles.total}>
            {t.rich("total", { count: otherMembers.length, strong: (chunks) => <strong>{chunks}</strong> })}
            {selection.length > 0 && <span className={styles["selected-count"]}>{t("selectedCount", { count: selection.length })}</span>}
          </p>
          <div className={styles["toolbar-group"]}>
            {(searchOpen || search) && (
              <input
                type="search"
                className={styles["search-input"]}
                aria-label={t("search")}
                placeholder={t("searchPlaceholder")}
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onBlur={() => { if (!search) setSearchOpen(false); }}
              />
            )}
            <button
              type="button"
              className={styles["icon-btn"]}
              aria-label={t("search")}
              aria-expanded={searchOpen || Boolean(search)}
              onClick={() => setSearchOpen(true)}
            >
              <Image src={memberSearchIcon} alt="" aria-hidden />
            </button>
            <div className={styles["filter-wrap"]} ref={filterMenuRef}>
              <button type="button" className={styles["filter-btn"]} aria-haspopup="listbox" aria-expanded={filterOpen}
                onClick={() => setFilterOpen(!filterOpen)}>
                {filter ? <span className={styles["filter-accent"]}>{t("roleFilterActive", { role: filter })}</span> : t("roleFilter")}
                <Image src={chevronDownIcon} alt="" aria-hidden />
              </button>
              {filterOpen && (
                <div className={styles["filter-menu"]} role="listbox" aria-label={t("roleFilterLabel")}>
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
                      {option === "" ? t("filterAll") : option}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* 삭제 (Figma btn 1742:4215): 고른 멤버가 없으면 off(회색), 있으면 on(빨강) */}
            <button
              type="button"
              className={styles["delete-btn"]}
              disabled={!isOwner || busy || selection.length === 0}
              aria-label={selection.length > 0 ? t("deleteSelectedCount", { count: selection.length }) : t("deleteSelected")}
              aria-haspopup="dialog"
              onClick={() => askRemove(visibleMembers.filter((member) => selection.includes(member.user_id)))}
            >
              {t("delete")}
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
              {t("invite")}
            </button>
          </div>
        </div>

        {(!workspaceId || error || loadError) && <p className={modalStyles["field-error"]} role="alert">{!workspaceId ? t("selectWorkspace") : error || getErrorMessage(loadError, t("loadFailed"), tShared)}</p>}
        {message && <p className={styles.note} role="status">{message}</p>}
        {myMembership && !isOwner && (
          <p className={styles.note}>
            {myMembership.permissions.length > 0
              ? t("myPermissions", { permissions: myMembership.permissions.map((value) => localizedWorkspacePermissionLabel(value, tShared)).join(", ") })
              : t("myPermissionsNone")}
          </p>
        )}

        <div className={styles.table}>
          <div className={cx(styles.row, styles["row-head"])}>
            <div className={styles["cell-user"]}>
              <SelectCheck
                checked={headCheck}
                label={t("selectAll")}
                disabled={busy || removableIds.length === 0}
                onToggle={() => setSelectedIds(toggleAllSelection(removableIds, selectedIds))}
              />
              <button type="button" className={styles["sort-btn"]}
                aria-label={sortDirection === "asc" ? t("sortDesc") : t("sortAsc")}
                onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")}>
                {t("user")}
                <Image src={sortVerticalIcon} alt="" aria-hidden />
              </button>
            </div>
            <span className={styles["cell-role"]}>{t("role")}</span>
            <span className={styles["cell-more"]} aria-hidden />
          </div>
          {isListPending && workspaceId && <p className={styles.empty} role="status">{t("loading")}</p>}
          {!isListPending && !loadError && visibleMembers.length === 0 && (
            <p className={styles.empty}>{otherMembers.length === 0 ? t("noMembers") : t("noMatches")}</p>
          )}
          {visibleMembers.map((member) => {
            const name = memberDisplayName(member);
            const lastOwner = member.role === "OWNER" && ownerCount <= 1;
            const isMenuOpen = openMenuId === member.user_id;
            const removable = removableIds.includes(member.user_id);
            return (
              <div className={styles.row} key={member.user_id}>
                <div className={styles["cell-user"]}>
                  <SelectCheck
                    checked={selection.includes(member.user_id)}
                    label={t("select", { name })}
                    disabled={busy || !removable}
                    title={isOwner && lastOwner ? t("lastOwnerDelete") : undefined}
                    onToggle={() => setSelectedIds(toggleSelection(selectedIds, member.user_id))}
                  />
                  <div className={styles.profile}>
                    {member.avatar_url
                      ? <UserAvatar avatarUrl={member.avatar_url} name={name} className={styles["profile-icon"]} />
                      : <Image src={memberAvatarIcon} alt="" aria-hidden className={styles["profile-icon"]} />}
                    <div className={styles["profile-text"]}>
                      <span className={styles["profile-name"]}>{member.display_name || tCommon("userFallback")}</span>
                      <span className={styles["profile-email"]}>{member.email}</span>
                    </div>
                  </div>
                </div>
                <div className={styles["cell-role"]}>
                  <OptionSelect
                    value={member.role}
                    placeholder={t("rolePlaceholder")}
                    options={MEMBER_ROLE_OPTIONS}
                    ariaLabel={t("roleLabel", { name, role: member.role })}
                    disabled={!isOwner || busy || lastOwner}
                    title={lastOwner ? t("lastOwnerRole") : undefined}
                    floating
                    onChange={(value) => changeRole(member, value as WorkspaceRole)}
                  />
                </div>
                <div className={styles["cell-more"]} ref={isMenuOpen ? rowMenuRef : undefined}>
                  <button type="button" className={styles["more-btn"]} aria-label={t("more", { name })} aria-haspopup="menu"
                    aria-expanded={isMenuOpen} onClick={() => setOpenMenuId(isMenuOpen ? null : member.user_id)}>
                    <Image src={moreDotsIcon} alt="" aria-hidden />
                  </button>
                  {isMenuOpen && (
                    <div className={styles["more-menu"]} role="menu" aria-label={t("menu", { name })}>
                      <p className={styles["menu-label"]}>{t("permissionItems")}</p>
                      {localizedWorkspacePermissions(tShared).map((item) => {
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
                            title={isMemberOwner ? t("ownerHasAll") : item.description}
                            onClick={() => togglePermission(member, item.value)}
                          >
                            <span>{item.label}</span>
                            <span className={styles["perm-state"]}>{checked ? t("on") : t("off")}</span>
                          </button>
                        );
                      })}
                      {isOwner && (
                        <button
                          type="button"
                          role="menuitem"
                          className={cx(styles["menu-option"], styles["is-danger"])}
                          disabled={!removable || busy}
                          title={lastOwner ? t("lastOwnerDelete") : undefined}
                          onClick={() => askRemove([member])}
                        >
                          {t("remove")}
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
      {/* 설정 화면 영역 안에 그리면 배경막이 사이드바를 덮지 못해 body로 올린다(AccountFlowModal과 같은 방식). */}
      {removeTargets && createPortal(
        <ConfirmModal
          titleId="member-remove-confirm-title"
          title={removeTargets.length === 1 ? t("removeConfirmTitleOne") : t("removeConfirmTitleMany", { count: removeTargets.length })}
          description={t("removeConfirmDescription", { names: formatNames(removeTargets.map(memberDisplayName)) })}
          confirmLabel={removeTargets.length === 1 ? t("delete") : t("removeConfirmMany", { count: removeTargets.length })}
          tone="danger"
          onConfirm={() => void removeSelected(removeTargets)}
          onCancel={() => setRemoveTargets(null)}
        />,
        document.body
      )}
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
