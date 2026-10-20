// 멤버 관리 표에 보일 멤버를 고르는 순수 로직(본인 제외 · 권한 필터 · 이름/이메일 검색 · 이름 정렬).
// node:test에서 별칭 없이 쓰려고 entities를 import하지 않고 필요한 필드만 받는다.

export type MemberRoleFilter = "" | "OWNER" | "MEMBER";
export type MemberSortDirection = "asc" | "desc";

type ListedMember = { email: string; display_name: string | null; role: string };

/** 표에 보이는 이름. 닉네임이 없으면 이메일이다. */
export function memberDisplayName(member: ListedMember): string {
  return member.display_name || member.email;
}

/** 본인(로그인한 사용자)을 뺀 멤버. 멤버 관리에는 초대한 다른 멤버만 보인다. 이메일·이름이 아니라 user_id로 가른다. */
export function excludeMember<T extends { user_id: string }>(members: readonly T[], userId: string): T[] {
  return members.filter((member) => member.user_id !== userId);
}

export function selectVisibleMembers<T extends ListedMember>(
  members: readonly T[],
  { roleFilter, search, sortDirection }: { roleFilter: MemberRoleFilter; search: string; sortDirection: MemberSortDirection }
): T[] {
  const query = search.trim().toLocaleLowerCase();
  const direction = sortDirection === "asc" ? 1 : -1;
  return members
    .filter((member) => !roleFilter || member.role === roleFilter)
    .filter((member) => `${member.display_name ?? ""} ${member.email}`.toLocaleLowerCase().includes(query))
    .sort((left, right) => direction * memberDisplayName(left).localeCompare(memberDisplayName(right), "ko"));
}

// --- 멤버 삭제 선택 (Figma 1540:21567 체크 칸 + 삭제 버튼 1742:4215) ---

/** 확인 모달·결과 알림에 이름을 몇 명까지 나열할지. 나머지는 "외 N명"으로 줄인다. */
const LISTED_NAME_LIMIT = 5;

export type SelectAllState = boolean | "mixed";
export type RemovalFailure = { name: string; reason: string };

/**
 * 삭제할 수 있는 멤버인지. OWNER만 다른 멤버를 지울 수 있고, 본인과 마지막 OWNER는 지울 수 없다.
 * ownerCount는 본인을 포함한 전체 멤버 기준이다.
 */
export function canRemoveMember(
  member: { user_id: string; role: string },
  { isOwner, selfId, ownerCount }: { isOwner: boolean; selfId: string | undefined; ownerCount: number }
): boolean {
  if (!isOwner || !selfId || member.user_id === selfId) return false;
  return !(member.role === "OWNER" && ownerCount <= 1);
}

/** 고른 id 중 지금 표에 보이고 삭제할 수 있는 것만 표 순서대로 남긴다. 필터로 숨긴 멤버는 지우지 않는다. */
export function effectiveSelection(removableIds: readonly string[], selectedIds: ReadonlySet<string>): string[] {
  return removableIds.filter((id) => selectedIds.has(id));
}

/** 머리 체크 칸 상태: 보이는 삭제 가능 멤버를 모두 골랐으면 true, 일부면 "mixed". */
export function selectAllState(removableIds: readonly string[], selectedIds: ReadonlySet<string>): SelectAllState {
  const count = effectiveSelection(removableIds, selectedIds).length;
  if (count === 0) return false;
  return count === removableIds.length ? true : "mixed";
}

/** 머리 체크 칸 토글: 모두 골라져 있으면 보이는 것만 풀고, 아니면 보이는 것을 모두 고른다. */
export function toggleAllSelection(removableIds: readonly string[], selectedIds: ReadonlySet<string>): Set<string> {
  const next = new Set(selectedIds);
  const allSelected = selectAllState(removableIds, selectedIds) === true;
  for (const id of removableIds) {
    if (allSelected) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** 행 체크 칸 토글. 원본 집합은 그대로 두고 새 집합을 돌려준다. */
export function toggleSelection(selectedIds: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** 이름 목록을 "「a」, 「b」 외 N명"으로 줄인다. */
export function summarizeMemberNames(names: readonly string[], limit = LISTED_NAME_LIMIT): string {
  const shown = names.slice(0, limit).map((name) => `「${name}」`).join(", ");
  return names.length > limit ? `${shown} 외 ${names.length - limit}명` : shown;
}

/** 삭제 결과를 한 번의 알림 문구로 만든다. 실패는 이유와 함께 나열한다. */
export function removalNotice(succeeded: number, failures: readonly RemovalFailure[]): { ok: boolean; text: string } {
  if (failures.length === 0) return { ok: true, text: `멤버 ${succeeded}명을 삭제했습니다.` };
  const shown = failures.slice(0, LISTED_NAME_LIMIT).map((failure) => `「${failure.name}」: ${failure.reason}`);
  if (failures.length > LISTED_NAME_LIMIT) shown.push(`외 ${failures.length - LISTED_NAME_LIMIT}명`);
  return { ok: false, text: [`성공 ${succeeded}명, 실패 ${failures.length}명`, ...shown].join(" · ") };
}
