import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSkills } from "@/entities/skill";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { applySlashSkill, slashSkillGroups, slashSkillQuery } from "../lib/skillSlashMenu";

/**
 * 채팅 입력창 "/" 스킬 목록 상태 (Figma 1627:9780). 입력이 "/…"인 동안 열리고, 스킬을 고르면 "/slug "로 채운다.
 * ↑↓로 강조를 옮기고 Tab(또는 화살표로 옮긴 뒤 Enter)으로 고른다. 그냥 Enter는 스킬 없이 보낸다. Esc는 목록만 닫는다.
 * 스킬 목록은 스킬 화면과 같은 쿼리 키(["skills", workspaceId])를 쓴다.
 */
export function useSkillSlashMenu({
  value,
  enabled,
  onChange
}: {
  value: string;
  enabled: boolean;
  onChange: (value: string) => void;
}) {
  const menuId = useId();
  const workspaceId = getSelectedWorkspaceId();
  const query = enabled ? slashSkillQuery(value) : null;
  // Esc로 닫은 입력. 입력이 바뀌면 다시 연다.
  const [dismissedValue, setDismissedValue] = useState<string | null>(null);
  const isOpen = query !== null && dismissedValue !== value;
  // 화살표로 고른 강조 항목. null이면 첫 항목을 강조만 하고 Enter는 보내기로 둔다.
  const [navigated, setNavigated] = useState<{ value: string; skillId: string } | null>(null);

  const { data: skills, isLoading } = useQuery({
    queryKey: ["skills", workspaceId],
    queryFn: () => fetchSkills(workspaceId ?? ""),
    enabled: isOpen && workspaceId != null
  });
  const groups = useMemo(() => slashSkillGroups(skills ?? [], query ?? ""), [skills, query]);
  const flatSkills = groups.flatMap((group) => group.skills);
  const navigatedId = navigated?.value === value && flatSkills.some((skill) => skill.id === navigated.skillId) ? navigated.skillId : null;
  const activeSkillId = navigatedId ?? flatSkills[0]?.id ?? null;

  function pick(slug: string) {
    setNavigated(null);
    onChange(applySlashSkill(slug));
  }

  /** 입력창 키를 먼저 받는다. 처리했으면 true. */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!isOpen || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedValue(value);
      return true;
    }
    if (flatSkills.length === 0) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = flatSkills.findIndex((skill) => skill.id === activeSkillId);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = navigatedId === null && step === 1 ? 0 : (index + step + flatSkills.length) % flatSkills.length;
      setNavigated({ value, skillId: flatSkills[next].id });
      return true;
    }
    const active = flatSkills.find((skill) => skill.id === activeSkillId);
    if (active && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && navigatedId !== null))) {
      event.preventDefault();
      pick(active.slug);
      return true;
    }
    return false;
  }

  return {
    isOpen,
    menuId,
    groups,
    activeSkillId,
    isLoading,
    pick,
    handleKeyDown
  };
}
