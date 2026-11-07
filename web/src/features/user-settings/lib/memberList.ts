// 멤버 관리 표에 보일 멤버를 고르는 순수 로직(본인 제외 · 권한 필터 · 이름/이메일 검색 · 이름 정렬).
// node:test에서 별칭 없이 쓰려고 entities를 import하지 않고 필요한 필드만 받는다.

export type MemberRoleFilter = "" | "OWNER" | "MEMBER";
export type MemberSortDirection = "asc" | "desc";

/**
 * 권한 고르기 목록(멤버 초대 모달·멤버 표의 행 권한)이 함께 쓰는 순서.
 * 초대 기본값이자 대부분의 멤버가 가진 MEMBER를 위에, 더 넓은 권한인 OWNER를 아래에 둔다.
 */
export const MEMBER_ROLE_OPTIONS: ReadonlyArray<{ value: "MEMBER" | "OWNER"; label: string }> = [
  { value: "MEMBER", label: "MEMBER" },
  { value: "OWNER", label: "OWNER" }
];

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

/** 이름 목록을 앞에서 limit명까지와 나머지 수로 나눈다. 문구("「a」, 「b」 외 N명")는 화면이 언어에 맞춰 만든다. */
export function summarizeMemberNames(names: readonly string[], limit = LISTED_NAME_LIMIT): { shown: string[]; hiddenCount: number } {
  return { shown: names.slice(0, limit), hiddenCount: Math.max(0, names.length - limit) };
}

export type RemovalNotice = {
  ok: boolean;
  succeeded: number;
  failed: number;
  /** 이유와 함께 나열할 실패(최대 LISTED_NAME_LIMIT명) */
  shownFailures: RemovalFailure[];
  hiddenFailures: number;
};

/** 삭제 결과를 한 번의 알림에 담을 값으로 만든다. 실패가 있으면 앞에서부터 이유와 함께 나열한다. */
export function removalNotice(succeeded: number, failures: readonly RemovalFailure[]): RemovalNotice {
  return {
    ok: failures.length === 0,
    succeeded,
    failed: failures.length,
    shownFailures: failures.slice(0, LISTED_NAME_LIMIT),
    hiddenFailures: Math.max(0, failures.length - LISTED_NAME_LIMIT)
  };
}
