import type { SkillResponse } from "@/entities/skill/model/skill";
import { skillKindLabel } from "@/entities/skill/model/skillKind";

export type SlashSkill = { id: string; slug: string; description: string };
export type SlashSkillGroup = { label: string; skills: SlashSkill[] };

const GROUP_ORDER = ["문서", "폴더 정리", "템플릿"];

/** 입력이 공백 없는 "/…"이면 / 뒤 검색어를, 아니면 null을 돌려준다. 스킬을 고른 뒤("/slug ")에는 목록을 닫는다. */
export function slashSkillQuery(value: string): string | null {
  const match = /^\/(\S*)$/.exec(value);
  return match ? match[1] : null;
}

/**
 * 채팅 입력창 "/" 스킬 목록 (Figma 1627:9886): 종류별(문서 → 폴더 정리 → 템플릿)로 묶는다.
 * 사용 중인 버전이 있는 스킬만 넣고, slug 앞부분이나 설명에 검색어가 있으면 남긴다.
 */
export function slashSkillGroups(skills: readonly SkillResponse[], query: string): SlashSkillGroup[] {
  const normalized = query.trim().toLowerCase();
  const groups = new Map<string, SlashSkill[]>();
  for (const skill of skills) {
    const version = skill.enabled_version;
    if (!version) continue;
    const matches = !normalized
      || skill.slug.toLowerCase().startsWith(normalized)
      || version.description.toLowerCase().includes(normalized);
    if (!matches) continue;
    const label = skillKindLabel(version.capabilities);
    groups.set(label, [...(groups.get(label) ?? []), { id: skill.id, slug: skill.slug, description: version.description }]);
  }
  return GROUP_ORDER.filter((label) => groups.has(label)).map((label) => ({ label, skills: groups.get(label) ?? [] }));
}

/** 고른 스킬로 입력을 바꾼다. 뒤에 요청을 이어 쓰도록 공백을 붙인다. */
export function applySlashSkill(slug: string): string {
  return `/${slug} `;
}
