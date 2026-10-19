// 멤버 관리 표에 보일 멤버를 고르는 순수 로직(권한 필터 · 이름/이메일 검색 · 이름 정렬).
// node:test에서 별칭 없이 쓰려고 entities를 import하지 않고 필요한 필드만 받는다.

export type MemberRoleFilter = "" | "OWNER" | "MEMBER";
export type MemberSortDirection = "asc" | "desc";

type ListedMember = { email: string; display_name: string | null; role: string };

/** 표에 보이는 이름. 닉네임이 없으면 이메일이다. */
export function memberDisplayName(member: ListedMember): string {
  return member.display_name || member.email;
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
