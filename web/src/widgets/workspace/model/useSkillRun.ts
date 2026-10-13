import { useEffect, useState } from "react";
import type { SkillResponse } from "@/entities/skill";
import type { RailView } from "@/widgets/rail-navigation/ui/RailNavigation";
import { findTreeItem, type Project, type TreeItem } from "@/entities/tree";
import { isMarkdownDocument } from "@/entities/document/lib/documentKind";
import type { DocumentItemResponse } from "@/entities/document";

/**
 * 스킬 "실행": 사이드바에서 대상 문서를 고르는 중인 스킬과 고른 트리 항목 (Figma 1527:15924).
 * 실행은 사용자가 할 일을 적어 보낼 때 에이전트가 하므로, 여기서는 채팅 입력창에 채울 커맨드까지만 만든다.
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
  /** 고른 Markdown 문서를 열고 채팅 패널을 띄운다. */
  onConfirmed: (item: TreeItem) => void;
}) {
  const [skillRun, setSkillRun] = useState<{ skill: SkillResponse; targetItemId: string | null; errorMessage: string | null } | null>(null);
  // 채팅 입력창에 채울 스킬 커맨드. 패널이 열린 뒤 한 번 채운다.
  const [agentComposerDraft, setAgentComposerDraft] = useState<{ id: number; text: string } | null>(null);

  // 스킬 화면을 벗어나면(레일·검색 결과 이동 등) 대상 고르기를 끝낸다.
  useEffect(() => {
    if (activeView !== "skills") setSkillRun(null);
  }, [activeView]);

  function startSkillRun(skill: SkillResponse) {
    onStart();
    setSkillRun({ skill, targetItemId: null, errorMessage: null });
  }

  /** 스킬은 문서 하나에만 실행한다(agent turn이 요청마다 문서 하나만 받는다). 다른 문서를 누르면 바꿔 고른다. */
  function pickSkillTarget(itemId: string) {
    setSkillRun((current) => current && {
      ...current,
      targetItemId: current.targetItemId === itemId ? null : itemId,
      errorMessage: null
    });
  }

  /** 고른 문서를 열고 채팅 패널 입력창에 "/slug "를 채운다. */
  function confirmSkillRun() {
    const targetItemId = skillRun?.targetItemId;
    if (!skillRun || !targetItemId) return;
    const item = projects.map((project) => findTreeItem(project.items, targetItemId)).find(Boolean);
    const targetDocument = item?.documentId ? documents.find((document) => document.id === item.documentId) : undefined;
    // 에이전트는 Markdown 문서에서만 스킬을 실행한다(백엔드 agent turn 제약).
    if (!item || !targetDocument || !isMarkdownDocument(targetDocument)) {
      setSkillRun({ ...skillRun, errorMessage: "Markdown 문서만 스킬을 실행할 수 있습니다. 다른 문서를 골라 주세요." });
      return;
    }
    setSkillRun(null);
    setAgentComposerDraft({ id: Date.now(), text: `/${skillRun.skill.slug} ` });
    onConfirmed(item);
  }

  function cancelSkillRun() {
    setSkillRun(null);
  }

  return { skillRun, agentComposerDraft, startSkillRun, pickSkillTarget, confirmSkillRun, cancelSkillRun };
}
