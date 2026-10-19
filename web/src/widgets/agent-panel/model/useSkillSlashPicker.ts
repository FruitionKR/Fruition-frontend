import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSkills } from "@/entities/skill";
import { getWorkspaceId } from "@/shared/api/client";
import { buildSkillPickerGroups, parseSkillSlashQuery, type SkillPickerItem } from "@/features/agent-chat/lib/taskThread";

/**
 * 작업 입력창의 "/" 스킬 고르기 상태(Figma 1627:9886).
 * 방향키로 고른 스킬이 있으면 Enter·Tab이 "/slug "를 채우고, 고르지 않았으면 Enter는 그대로 보낸다
 * ("스킬 없이 질문·요청하려면 Enter"). Esc는 목록을 닫는다.
 */
export function useSkillSlashPicker({
  value,
  isEnabled,
  onChange
}: {
  value: string;
  isEnabled: boolean;
  onChange: (value: string) => void;
}) {
  const query = isEnabled ? parseSkillSlashQuery(value) : null;
  const [dismissedValue, setDismissedValue] = useState<string | null>(null);
  const isOpen = query !== null && dismissedValue !== value;
  const workspaceId = getWorkspaceId();
  // 스킬 화면과 같은 쿼리 키를 써서 목록 캐시를 함께 쓴다.
  const skills = useQuery({
    queryKey: ["skills", workspaceId],
    queryFn: () => fetchSkills(workspaceId),
    enabled: isOpen && Boolean(workspaceId),
    staleTime: 30_000
  });
  const groups = useMemo(() => buildSkillPickerGroups(skills.data ?? [], query ?? ""), [skills.data, query]);
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);

  // 검색어가 바뀌면 고른 항목을 다시 정한다(목록에 없는 항목을 가리키지 않게).
  useEffect(() => {
    setActiveSkillId((current) => (current && items.some((item) => item.id === current) ? current : null));
  }, [items]);

  const statusMessage = skills.isLoading
    ? "스킬 목록을 불러오는 중이에요."
    : skills.error
      ? "스킬 목록을 불러오지 못했어요."
      : (skills.data ?? []).length === 0 ? "사용 중인 스킬이 없어요." : null;

  function pick(item: SkillPickerItem) {
    onChange(`/${item.slug} `);
    setActiveSkillId(null);
  }

  function moveActive(step: number) {
    if (items.length === 0) return;
    const index = items.findIndex((item) => item.id === activeSkillId);
    const next = index < 0 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
    setActiveSkillId(items[next].id);
  }

  /** 입력창 키 처리. 목록이 열려 있을 때만 가로챈다. */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!isOpen || event.nativeEvent.isComposing) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedValue(value);
      return true;
    }
    const active = items.find((item) => item.id === activeSkillId);
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      if (active) {
        event.preventDefault();
        pick(active);
        return true;
      }
      // "/"만 있으면 보낼 내용이 없다. 목록만 닫는다.
      if (event.key === "Enter" && value.trim() === "/") {
        event.preventDefault();
        setDismissedValue(value);
        return true;
      }
    }
    return false;
  }

  return { isOpen, groups, activeSkillId, statusMessage, pick, setActiveSkillId, handleKeyDown };
}
