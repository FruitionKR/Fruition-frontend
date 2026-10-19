import { useEffect, useState } from "react";
import type { SkillResponse } from "@/entities/skill";
import type { DocumentItemResponse } from "@/entities/document";
import { findTreeItem, type Project } from "@/entities/tree";
import type { RailView } from "@/widgets/rail-navigation/ui/RailNavigation";
import { resolveSkillRunTarget, skillRunMessage, type SkillRunTarget } from "../lib/skillRunTarget";

/** 고른 대상으로 작업 탭에 보낼 스킬 실행 요청. id가 바뀔 때마다 한 번 보낸다. */
export type SkillRunRequest = {
  id: number;
  skill: SkillResponse;
  target: SkillRunTarget;
  message: string;
};

/**
 * 스킬 "실행"(Figma 1567:25081): 스킬 화면을 어둡게 덮고 안내 말풍선을 띄운 채 사이드바 트리에서 대상을 고른다.
 * 문서 스킬은 고칠 문서(또는 새 문서를 둘 폴더), 폴더 정리 스킬은 정리할 폴더를 고른다.
 * '다음'을 누르면 고른 대상으로 작업 탭 요청을 만들어 onConfirmed로 넘긴다.
 */
export function useSkillRun({
  activeView,
  projects,
  documents,
  onStart,
  onConfirmed
}: {
  activeView: RailView;
  projects: Project[];
  documents: DocumentItemResponse[];
  /** 대상은 사이드바 문서 패널에서 고르므로 접혀 있으면 편다. */
  onStart: () => void;
  onConfirmed: (request: SkillRunRequest) => void;
}) {
  const [skillRun, setSkillRun] = useState<{ skill: SkillResponse; target: SkillRunTarget | null; errorMessage: string | null } | null>(null);

  // 스킬 화면을 벗어나면(레일·검색 결과 이동 등) 대상 고르기를 끝낸다.
  useEffect(() => {
    if (activeView !== "skills") setSkillRun(null);
  }, [activeView]);

  function startSkillRun(skill: SkillResponse) {
    onStart();
    setSkillRun({ skill, target: null, errorMessage: null });
  }

  /** 대상은 하나만 고른다. 같은 항목을 다시 누르면 고르기를 푼다. */
  function pickSkillTarget(itemId: string) {
    if (!skillRun) return;
    const item = projects.map((project) => findTreeItem(project.items, itemId)).find(Boolean);
    if (!item) return;
    const resolution = resolveSkillRunTarget(skillRun.skill.enabled_version, item, documents);
    if (resolution.status === "ignore") return;
    if (resolution.status === "invalid") {
      setSkillRun({ ...skillRun, target: null, errorMessage: resolution.message });
      return;
    }
    const isSame = skillRun.target?.itemId === resolution.target.itemId;
    setSkillRun({ ...skillRun, target: isSame ? null : resolution.target, errorMessage: null });
  }

  function confirmSkillRun() {
    if (!skillRun?.target) return;
    const { skill, target } = skillRun;
    setSkillRun(null);
    onConfirmed({ id: Date.now(), skill, target, message: skillRunMessage(skill.slug) });
  }

  function cancelSkillRun() {
    setSkillRun(null);
  }

  return { skillRun, startSkillRun, pickSkillTarget, confirmSkillRun, cancelSkillRun };
}
