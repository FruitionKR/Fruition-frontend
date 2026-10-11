"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteSkill,
  enableSkill,
  fetchSkills,
  updateSkill,
  type SkillResponse
} from "@/entities/skill";
import { getErrorMessage } from "@/shared/lib/errors";
import { needsSkillEnable } from "../lib/skillTable";

export type SkillDraft = { description: string; instructionsMarkdown: string };

/**
 * 스킬 목록·정의 수정·삭제. 스킬은 항상 사용 상태로 두므로 꺼진 스킬은 불러오는 대로 켠다. 스킬 만들기 위저드의 중복 커맨드 검사와
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

  // 켜기를 시도한 스킬 id. 실패해도 같은 스킬을 목록을 받을 때마다 다시 요청하지 않는다.
  const enableAttemptedIds = useRef(new Set<string>());
  useEffect(() => {
    if (workspaceId == null) return;
    const targets = (listQuery.data ?? []).filter(
      (skill) => needsSkillEnable(skill) && !enableAttemptedIds.current.has(skill.id)
    );
    for (const skill of targets) {
      enableAttemptedIds.current.add(skill.id);
      enableSkill(workspaceId, skill.id)
        .then(replaceSkill)
        .catch((error: unknown) => setActionError(getErrorMessage(error, "스킬을 사용 상태로 바꾸지 못했습니다.")));
    }
    // replaceSkill은 queryKey로만 결정되어 목록·워크스페이스가 바뀔 때만 다시 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery.data, workspaceId]);

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
    updateMutation,
    deleteMutation,
    refresh: () => queryClient.invalidateQueries({ queryKey })
  };
}
