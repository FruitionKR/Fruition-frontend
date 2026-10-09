import type { SkillResponse } from "@/entities/skill/model/skill";

/** 스킬 화면 상단 탭 (Figma 1482:10605): 전체 / 팀 / 개인 = 저장범위 필터 */
export type SkillTab = "all" | "team" | "personal";

/** 사용 상태 필터 (설정 모달 스킬 패널에서 옮겨 온 "상태" 필터) */
export type SkillStateFilter = "all" | "enabled" | "disabled";

/** 정렬은 커맨드명과 저장범위로만 한다 */
export type SkillSortKey = "command" | "scope";
export type SkillSort = { key: SkillSortKey; direction: "asc" | "desc" } | null;

/** 자동 선택·실행은 서버 상태가 enabled이고 게시된 버전이 있을 때만 된다. */
export function isSkillEnabled(skill: SkillResponse): boolean {
  return skill.status === "enabled" && skill.enabled_version != null;
}

export function skillCommand(skill: SkillResponse): string {
  return `/${skill.slug}`;
}

export function skillDescription(skill: SkillResponse): string {
  return (skill.enabled_version ?? skill.latest_version)?.description ?? "";
}

/** 사용 스위치를 눌렀을 때 보낼 요청. 게시 버전이 남아 있어도 disabled면 OFF이므로 활성화한다. */
export function skillToggleAction(skill: SkillResponse): "enable" | "disable" {
  return isSkillEnabled(skill) ? "disable" : "enable";
}

/** personal이 아니면 워크스페이스 공용(팀)이다. */
export function isPersonalSkill(skill: SkillResponse): boolean {
  return skill.scope_type === "personal";
}

export function filterSkillsByTab(skills: readonly SkillResponse[], tab: SkillTab): SkillResponse[] {
  if (tab === "all") return [...skills];
  return skills.filter((skill) => isPersonalSkill(skill) === (tab === "personal"));
}

export function filterSkillsByState(skills: readonly SkillResponse[], filter: SkillStateFilter): SkillResponse[] {
  if (filter === "all") return [...skills];
  return skills.filter((skill) => isSkillEnabled(skill) === (filter === "enabled"));
}

// 오름차순 기준값. 저장범위는 개인 → 팀 순서다.
const SORT_VALUES: Record<SkillSortKey, (skill: SkillResponse) => string | number> = {
  command: (skill) => skill.slug,
  scope: (skill) => (isPersonalSkill(skill) ? 0 : 1)
};

export function sortSkills(skills: readonly SkillResponse[], sort: SkillSort): SkillResponse[] {
  if (!sort) return [...skills];
  const valueOf = SORT_VALUES[sort.key];
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...skills].sort((left, right) => {
    const a = valueOf(left);
    const b = valueOf(right);
    const order = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "ko");
    return order * sign;
  });
}

/** 같은 열 머리글을 누르면 오름 → 내림 → 해제, 다른 열은 오름차순부터. */
export function nextSkillSort(current: SkillSort, key: SkillSortKey): SkillSort {
  if (current?.key !== key) return { key, direction: "asc" };
  return current.direction === "asc" ? { key, direction: "desc" } : null;
}
