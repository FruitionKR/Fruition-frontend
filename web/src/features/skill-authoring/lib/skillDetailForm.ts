import type { SkillAuthoringResult, SkillExecutionOptions, SkillResponse } from "@/entities/skill/model/skill";
import {
  INITIAL_SKILL_CREATE_FORM,
  isDocumentKind,
  kindFromCapabilities,
  SKILL_DESCRIPTION_MAX,
  SKILL_INSTRUCTIONS_MAX,
  SKILL_TARGET_OPTIONS,
  skillExecutionOptions,
  TARGETS_REQUIRED_MESSAGE,
  targetsFromValues,
  type SkillCreateForm,
  type SkillKind,
  type SkillResultMode,
  type SkillScope,
  type SkillTarget
} from "./skillCreateForm";

/**
 * 스킬 상세 시트(Figma 1708:4059) 입력값.
 * 대상·결과 방식은 버전의 targets·result_mode에서 읽는다(ai#122). PATCH가 받는 값은 설명·지침·대상·결과 방식이다.
 * 결과 방식은 PATCH가 지침을 다시 분류한 capabilities와 맞아야 해, 저장범위·커맨드명·스킬 종류와 함께 읽기 전용으로 둔다.
 */
export interface SkillDetailForm {
  /** capabilities를 알 수 없으면 null(종류·결과 방식·대상을 표시하지 않는다) */
  kind: SkillKind | null;
  resultMode: SkillResultMode;
  scope: SkillScope;
  command: string;
  description: string;
  rules: string;
  targets: readonly SkillTarget[];
}

// 이전 만들기 시트가 대상·결과 방식을 지침 끝에 붙이던 "## 실행 대상" 절 형식.
// 서버에 필드가 생기기 전에 게시된 스킬을 열 때만 되읽고, 저장할 때 지침에서 떼어 targets로 보낸다.
const LEGACY_TARGET_SECTION_HEADING = "## 실행 대상";
const LEGACY_TARGET_LINES: Record<SkillTarget, string> = {
  "current-document": "- 현재 문서",
  selection: "- 사용자가 선택한 부분 (선택한 부분이 있으면 그 부분만 다룬다)"
};
const LEGACY_AUTO_RESULT_LINE = "- 새 문서로 만들지 현재 문서를 고칠지 대상이 애매하면 먼저 사용자에게 되묻는다.";

export interface ParsedSkillInstructions {
  rules: string;
  /** 절에 적힌 대상. 절이 없으면 null */
  targets: SkillTarget[] | null;
}

/** 이전 만들기 시트가 만들던 지침 문자열 그대로. 되읽은 결과가 이것과 같아야 기계가 붙인 절로 본다. */
function legacyInstructions(rules: string, targets: readonly SkillTarget[], hasAutoLine: boolean): string {
  const lines = SKILL_TARGET_OPTIONS.filter((option) => targets.includes(option.value)).map(
    (option) => LEGACY_TARGET_LINES[option.value]
  );
  if (hasAutoLine) lines.push(LEGACY_AUTO_RESULT_LINE);
  return `${rules}\n\n${LEGACY_TARGET_SECTION_HEADING}\n\n${lines.join("\n")}`;
}

/**
 * 지침 끝의 "## 실행 대상" 절을 실행 규칙과 대상으로 나눈다.
 * 이전 만들기 시트가 만든 형식과 글자 하나까지 같을 때만 떼어 낸다. 사용자가 손댄 절은 지침에 그대로 둔다.
 */
export function parseSkillInstructions(markdown: string): ParsedSkillInstructions {
  const trimmed = markdown.trim();
  const untouched: ParsedSkillInstructions = { rules: trimmed, targets: null };
  const marker = `\n\n${LEGACY_TARGET_SECTION_HEADING}\n\n`;
  const index = trimmed.lastIndexOf(marker);
  if (index < 0) return untouched;

  const rules = trimmed.slice(0, index).trim();
  const lines = trimmed.slice(index + marker.length).split("\n");
  const targets = SKILL_TARGET_OPTIONS.map((option) => option.value).filter((target) =>
    lines.includes(LEGACY_TARGET_LINES[target])
  );
  const hasAutoLine = lines.includes(LEGACY_AUTO_RESULT_LINE);
  if (rules === "" || legacyInstructions(rules, targets, hasAutoLine) !== trimmed) return untouched;
  return { rules, targets };
}

/**
 * 스킬 응답 → 상세 시트 초기값. 켜진 버전이 있으면 그 버전을, 없으면 최신 버전을 보여 준다.
 * 지침에 이전 형식의 "실행 대상" 절이 있으면 그 절이 사용자가 고른 대상이다
 * (필드가 없던 때 게시돼 서버 targets는 기본값이거나 두 대상 모두로 읽힌다). 절은 떼어 내고 저장할 때 targets로 보낸다.
 */
export function skillDetailForm(skill: SkillResponse): SkillDetailForm {
  const version = skill.enabled_version ?? skill.latest_version;
  const kindAndResult = kindFromCapabilities(version?.capabilities ?? []);
  const parsed = parseSkillInstructions(version?.instructions_markdown ?? "");
  const storedTargets = targetsFromValues(version?.targets ?? []);
  const legacyTargets = parsed.targets != null && parsed.targets.length > 0 ? parsed.targets : null;
  return {
    kind: kindAndResult?.kind ?? null,
    resultMode: version?.result_mode ?? kindAndResult?.resultMode ?? INITIAL_SKILL_CREATE_FORM.resultMode,
    scope: skill.scope_type === "personal" ? "personal" : "team",
    command: skill.slug,
    description: version?.description ?? "",
    rules: parsed.rules,
    targets: legacyTargets ?? (storedTargets.length > 0 ? storedTargets : INITIAL_SKILL_CREATE_FORM.targets)
  };
}

export type SkillDetailDraft = { description: string; instructionsMarkdown: string } & SkillExecutionOptions;

/** 상세 입력값 → 목록 훅의 수정 초안(skillUpdateRequest 입력). 문서 스킬이면 대상·결과 방식을 함께 보낸다. */
export function skillDetailDraft(form: SkillDetailForm): SkillDetailDraft {
  return {
    description: form.description.trim(),
    instructionsMarkdown: form.rules.trim(),
    ...(form.kind == null ? {} : skillExecutionOptions(form.kind, form.resultMode, form.targets))
  };
}

export type SkillDetailField = "description" | "rules" | "targets";

export function validateSkillDetailForm(form: SkillDetailForm): Partial<Record<SkillDetailField, string>> {
  const errors: Partial<Record<SkillDetailField, string>> = {};
  const description = form.description.trim();
  if (description === "") errors.description = "설명을 입력해 주세요.";
  else if (description.length > SKILL_DESCRIPTION_MAX) {
    errors.description = `설명은 ${SKILL_DESCRIPTION_MAX}자까지 쓸 수 있습니다.`;
  }
  if (form.rules.trim() === "") errors.rules = "실행 규칙을 입력해 주세요.";
  else if (form.rules.trim().length > SKILL_INSTRUCTIONS_MAX) {
    errors.rules = `실행 규칙은 ${SKILL_INSTRUCTIONS_MAX.toLocaleString("ko-KR")}자까지 쓸 수 있습니다.`;
  }
  if (form.kind != null && isDocumentKind(form.kind) && form.targets.length === 0) errors.targets = TARGETS_REQUIRED_MESSAGE;
  return errors;
}

/** AI 작성 요청(skillAuthorRequest)에 넘길 만들기 시트 모양 입력값 */
export function skillDetailAuthorForm(form: SkillDetailForm): SkillCreateForm {
  return {
    ...INITIAL_SKILL_CREATE_FORM,
    ...(form.kind != null ? { kind: form.kind, resultMode: form.resultMode } : {}),
    targets: form.targets,
    scope: form.scope,
    command: form.command,
    description: form.description,
    rules: form.rules
  };
}

/**
 * AI 초안을 상세 시트에 채운다. 게시된 스킬의 종류·결과 방식은 바꿀 수 없어 실행 규칙만 바꾸고,
 * 설명은 비어 있을 때만 제안값으로 채운다.
 */
export function applySkillDetailDraft(
  form: SkillDetailForm,
  draft: Pick<SkillAuthoringResult, "description" | "instructions_markdown">
): SkillDetailForm {
  const suggestedDescription = (draft.description ?? "").trim();
  const instructions = (draft.instructions_markdown ?? "").trim();
  return {
    ...form,
    rules: instructions !== "" ? instructions : form.rules,
    description: form.description.trim() === "" ? suggestedDescription.slice(0, SKILL_DESCRIPTION_MAX) : form.description
  };
}
