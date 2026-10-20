import { useEffect, useState } from "react";
import type { SkillResponse } from "@/entities/skill";
import type { DocumentItemResponse } from "@/entities/document";
import { findItemLocation, findTreeItem, type Project } from "@/entities/tree";
import type { RailView } from "@/widgets/rail-navigation/ui/RailNavigation";
import {
  folderMarkdownCount,
  resolveSkillRunTarget,
  skillRunBlockedMessage,
  skillRunFolderId,
  skillRunMessage,
  skillRunPreview,
  skillRunSourceDocumentId,
  type SkillRunTarget
} from "../lib/skillRunTarget";

/** 고른 대상으로 작업 탭에 보낼 스킬 실행 요청. id가 바뀔 때마다 한 번 보낸다. */
export type SkillRunRequest = {
  id: number;
  skill: SkillResponse;
  target: SkillRunTarget;
  message: string;
  /** 작업 대상 폴더(folder_id). 폴더 정리 범위이자 새 문서를 둘 위치다. */
  folderId: string | null;
  /** 원문으로 함께 보낼 문서. 원문이 필요 없는 '새 문서로 만들기'에 문서를 골랐으면 null(위치만 쓴다). */
  sourceDocumentId: string | null;
};

type SkillRunState = {
  skill: SkillResponse;
  target: SkillRunTarget | null;
  errorMessage: string | null;
  /** 고른 대상으로 무엇을 할지 미리 알려 주는 문구. 알 수 없으면 null */
  preview: string | null;
};

/**
 * 스킬 "실행"(Figma 1567:25081): 스킬 화면을 어둡게 덮고 안내 말풍선을 띄운 채 사이드바 트리에서 대상을 고른다.
 * 문서 스킬은 고칠 문서(또는 요약·변환할 문서나 새 문서를 둘 폴더), 폴더 정리 스킬은 정리할 폴더를 고른다.
 * 대상이 '선택한 부분'뿐인 스킬은 처음부터 안내만 띄우고 고르지 못하게 한다.
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
  const [skillRun, setSkillRun] = useState<SkillRunState | null>(null);

  // 스킬 화면을 벗어나면(레일·검색 결과 이동 등) 대상 고르기를 끝낸다.
  useEffect(() => {
    if (activeView !== "skills") setSkillRun(null);
  }, [activeView]);

  function startSkillRun(skill: SkillResponse) {
    onStart();
    setSkillRun({ skill, target: null, errorMessage: skillRunBlockedMessage(skill.enabled_version, skill.slug), preview: null });
  }

  /** 대상은 하나만 고른다. 같은 항목을 다시 누르면 고르기를 푼다. */
  function pickSkillTarget(itemId: string) {
    if (!skillRun) return;
    const item = projects.map((project) => findTreeItem(project.items, itemId)).find(Boolean);
    if (!item) return;
    // 문서 목록 응답에 folder_id가 없을 수 있어, 새 문서를 둘 부모 폴더는 트리 위치로 찾는다.
    const location = findItemLocation(projects, itemId);
    const project = projects.find((entry) => entry.id === location?.projectId);
    const parentFolderId = location ? location.folderId ?? project?.folderId ?? null : undefined;
    const resolution = resolveSkillRunTarget(skillRun.skill.enabled_version, item, documents, skillRun.skill.slug, parentFolderId);
    if (resolution.status === "ignore") return;
    if (resolution.status === "invalid") {
      setSkillRun({ ...skillRun, target: null, errorMessage: resolution.message, preview: null });
      return;
    }
    const isSame = skillRun.target?.itemId === resolution.target.itemId;
    const target = isSame ? null : resolution.target;
    // 폴더 문서 수는 사이드바 트리의 바로 아래 Markdown 문서로 센다(AI가 읽는 범위와 같다).
    const preview = target ? skillRunPreview(skillRun.skill.enabled_version, target, folderMarkdownCount(item, documents)) : null;
    setSkillRun({ ...skillRun, target, errorMessage: null, preview });
  }

  function confirmSkillRun() {
    if (!skillRun?.target) return;
    const { skill, target } = skillRun;
    setSkillRun(null);
    const version = skill.enabled_version;
    onConfirmed({
      id: Date.now(),
      skill,
      target,
      message: skillRunMessage(skill.slug),
      folderId: skillRunFolderId(version, target),
      sourceDocumentId: skillRunSourceDocumentId(version, target)
    });
  }

  function cancelSkillRun() {
    setSkillRun(null);
  }

  return { skillRun, startSkillRun, pickSkillTarget, confirmSkillRun, cancelSkillRun };
}
