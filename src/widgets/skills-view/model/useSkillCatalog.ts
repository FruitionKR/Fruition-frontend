"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteSkill,
  disableSkill,
  enableSkill,
  fetchSkills,
  updateSkill,
  type SkillResponse
} from "@/entities/skill";
import { getErrorMessage } from "@/shared/lib/errors";
import { skillToggleAction } from "../lib/skillTable";

export type SkillDraft = { description: string; instructionsMarkdown: string };

/**
 * 스킬 목록·사용 켜기/끄기·정의 수정·삭제. 스킬 만들기 위저드의 중복 커맨드 검사와
 * 같은 쿼리 키(["skills", workspaceId])를 쓴다.
 */
export function useSkillCatalog(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["skills", workspaceId] as const, [workspaceId]);
  const [actionError, setActionError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey,
    queryFn: () => fetchSkills(workspaceId ?? ""),
    enabled: workspaceId != null
  });

  function replaceSkill(updated: SkillResponse) {
    queryClient.setQueryData<SkillResponse[]>(queryKey, (current) =>
      current?.map((skill) => (skill.id === updated.id ? updated : skill))
    );
  }

  const toggleMutation = useMutation({
    mutationFn: (skill: SkillResponse) =>
      skillToggleAction(skill) === "disable" ? disableSkill(workspaceId ?? "", skill.id) : enableSkill(workspaceId ?? "", skill.id),
    onSuccess: (updated) => {
      setActionError(null);
      replaceSkill(updated);
    },
    onError: (error: unknown) => setActionError(getErrorMessage(error, "스킬 사용 여부를 변경하지 못했습니다."))
  });

  const updateMutation = useMutation({
    mutationFn: ({ skill, draft }: { skill: SkillResponse; draft: SkillDraft }) =>
      updateSkill(workspaceId ?? "", skill.id, {
        description: draft.description,
        instructions_markdown: draft.instructionsMarkdown
      }),
    // PATCH 응답은 SkillResponse가 아니어서 목록을 다시 받는다.
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  });

  const deleteMutation = useMutation({
    mutationFn: (skill: SkillResponse) => deleteSkill(workspaceId ?? "", skill.id),
    onSuccess: (_, skill) => {
      queryClient.setQueryData<SkillResponse[]>(queryKey, (current) => current?.filter((item) => item.id !== skill.id));
      void queryClient.invalidateQueries({ queryKey });
    }
  });

  return {
    skills: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    loadError: listQuery.error ? getErrorMessage(listQuery.error, "스킬 목록을 불러오지 못했습니다.") : null,
    actionError,
    toggleMutation,
    updateMutation,
    deleteMutation,
    refresh: () => queryClient.invalidateQueries({ queryKey })
  };
}
