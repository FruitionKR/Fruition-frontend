import { useState } from "react";
import { skillKindLabel, type SkillResponse } from "@/entities/skill";
import type { DocumentItemResponse } from "@/entities/document";
import { documentDisplayName, pickerDocuments } from "@/features/skill-authoring/lib/referenceDocumentPicker";
import { getErrorMessage } from "@/shared/lib/apiErrors";

/**
 * 스킬 "실행": 채팅 패널의 "선택 필요" 카드(Figma 1571:27625 · 1610:9350)에서 실행할 문서를 고른다.
 * 실행은 사용자가 할 일을 적어 보낼 때 에이전트가 하므로, 여기서는 문서를 열고 채팅 입력창에 "/slug "를 채우는 데까지 한다.
 * 문서 스킬은 Markdown 문서 하나에 실행하므로 Markdown 문서만 고를 수 있다. 폴더 정리 스킬은 문서 없이
 * 작업 탭 요청(mode=task)으로 보내므로 고르기 없이 바로 커맨드를 채운다.
 */
export function useSkillRun({
  documents,
  onStart,
  onConfirmed,
  onCreateDocument
}: {
  documents: DocumentItemResponse[];
  /** 홈 화면으로 가서 채팅 패널을 연다(카드는 채팅 패널에 뜬다). */
  onStart: () => void;
  /** 고른 Markdown 문서를 연다. */
  onConfirmed: (document: DocumentItemResponse) => void;
  /** "새 문서로 만들기": 스킬을 실행할 빈 Markdown 문서를 만들고 연다. */
  onCreateDocument: (skill: SkillResponse) => Promise<void>;
}) {
  const [skillRun, setSkillRun] = useState<{ skill: SkillResponse; isCreating: boolean; errorMessage: string | null } | null>(null);
  // 채팅 입력창에 채울 스킬 커맨드. 패널이 열린 뒤 한 번 채운다.
  const [agentComposerDraft, setAgentComposerDraft] = useState<{ id: number; text: string } | null>(null);
  const candidates = pickerDocuments(documents, "");

  function startSkillRun(skill: SkillResponse) {
    onStart();
    if (skill.enabled_version?.capabilities.includes("folder-organize")) {
      fillComposer(skill);
      return;
    }
    setSkillRun({ skill, isCreating: false, errorMessage: null });
  }

  function fillComposer(skill: SkillResponse) {
    setSkillRun(null);
    setAgentComposerDraft({ id: Date.now(), text: `/${skill.slug} ` });
  }

  /** 스킬은 문서 하나에만 실행한다(agent turn이 요청마다 문서 하나만 받는다). 고르면 바로 문서를 열고 커맨드를 채운다. */
  function pickSkillTarget(documentId: string) {
    const target = candidates.find((document) => document.id === documentId);
    if (!skillRun || !target) return;
    fillComposer(skillRun.skill);
    onConfirmed(target);
  }

  async function createSkillTargetDocument() {
    if (!skillRun || skillRun.isCreating) return;
    const { skill } = skillRun;
    setSkillRun({ skill, isCreating: true, errorMessage: null });
    try {
      await onCreateDocument(skill);
      fillComposer(skill);
    } catch (error: unknown) {
      setSkillRun({ skill, isCreating: false, errorMessage: getErrorMessage(error, "새 문서를 만들지 못했습니다.") });
    }
  }

  function cancelSkillRun() {
    setSkillRun(null);
  }

  const skillTarget = skillRun ? {
    kindLabel: skillKindLabel(skillRun.skill.enabled_version?.capabilities ?? []),
    slug: skillRun.skill.slug,
    description: skillRun.skill.enabled_version?.description ?? "",
    options: candidates.map((document) => ({ value: document.id, label: documentDisplayName(document) })),
    isCreating: skillRun.isCreating,
    errorMessage: skillRun.errorMessage,
    onPick: pickSkillTarget,
    onCreateDocument: () => void createSkillTargetDocument(),
    onCancel: cancelSkillRun
  } : null;

  return { skillTarget, agentComposerDraft, startSkillRun };
}
