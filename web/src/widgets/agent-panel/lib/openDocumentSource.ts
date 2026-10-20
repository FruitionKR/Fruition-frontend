import type { SkillResponse } from "@/entities/skill";
import { slashCommandSlug } from "@/features/agent-chat/lib/taskThread";
import { skillRunIntent, type SkillRunIntent } from "@/widgets/workspace/lib/skillRunTarget";

/**
 * 작업 탭 입력의 `/slug`가 가리키는 사용 중인 스킬이 하는 일. 스킬 커맨드가 아니거나 목록에 없으면 null.
 */
export function composerSkillIntent(message: string, skills: readonly SkillResponse[] | undefined): SkillRunIntent | null {
  const slug = slashCommandSlug(message);
  if (!slug || !skills) return null;
  const skill = skills.find((entry) => entry.slug === slug && entry.status === "enabled" && entry.enabled_version);
  return skill ? skillRunIntent(skill.enabled_version) : null;
}

/**
 * 열린 문서를 직접 넣어야만 원문으로 쓰는지. '새 문서로 만들기' 스킬을 채팅에서 실행하면 열린 문서가 요청과
 * 무관할 수 있어 기본으로 빼고, "현재 문서" 칩을 눌러야 원문으로 싣는다.
 */
export function isOpenDocumentOptIn(intent: SkillRunIntent | null): boolean {
  return intent === "create";
}

/**
 * 작업 탭 요청에 열린 문서(active_markdown_context·document_id·base_version)를 실을지.
 * - `@문서`로 고른 문서가 있으면 그 문서만 원문이다(열린 문서는 싣지 않는다).
 * - '새 문서로 만들기' 스킬은 칩을 눌러 원문으로 쓰겠다고 했을 때만 싣는다.
 * - 그 밖(일반 요청·고치기·상황에 맞게·템플릿·폴더 정리)은 칩에서 빼지 않았으면 싣는다.
 */
export function shouldSendOpenDocument({
  intent,
  isExcluded,
  isOptedIn,
  hasDocumentMention
}: {
  intent: SkillRunIntent | null;
  /** "현재 문서" 칩의 ×로 뺐다. */
  isExcluded: boolean;
  /** '새 문서로 만들기' 스킬에서 칩을 눌러 원문으로 쓰겠다고 했다. */
  isOptedIn: boolean;
  hasDocumentMention: boolean;
}): boolean {
  if (hasDocumentMention) return false;
  return isOpenDocumentOptIn(intent) ? isOptedIn : !isExcluded;
}
