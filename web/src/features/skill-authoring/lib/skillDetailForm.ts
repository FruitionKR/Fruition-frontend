import type { SkillAuthoringResult, SkillResponse } from "@/entities/skill/model/skill";
import {
  AUTO_RESULT_INSTRUCTION,
  composeSkillInstructions,
  INITIAL_SKILL_CREATE_FORM,
  isDocumentKind,
  kindFromCapabilities,
  SKILL_DESCRIPTION_MAX,
  SKILL_INSTRUCTIONS_MAX,
  SKILL_TARGET_OPTIONS,
  TARGET_INSTRUCTION_LINES,
  TARGET_SECTION_HEADING,
  type SkillCreateForm,
  type SkillKind,
  type SkillResultMode,
  type SkillScope,
  type SkillTarget
} from "./skillCreateForm";

/**
 * 스킬 상세 시트(Figma 1708:4059) 입력값.
 * 대상·결과 방식은 백엔드 필드가 없다(Fruition-ai#115 / Fruition-document#144).
 * 대상은 만들기 시트가 지침 끝에 붙인 "## 실행 대상" 절에서 되읽고, 결과 방식은 capabilities에서 되돌린다.
 * PATCH /skills/{id}는 이름·설명·지침만 받아 저장범위·커맨드명·스킬 종류·결과 방식은 고칠 수 없다.
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
  /** 원래 지침에 "실행 대상" 절이 있었는지. 없고 대상도 고르지 않았으면 지침을 그대로 저장한다. */
  hasTargetSection: boolean;
}

export type ParsedSkillInstructions = Pick<SkillDetailForm, "rules" | "targets" | "hasTargetSection">;

const SECTION_PATTERN = new RegExp(`(?:^|\\n)${TARGET_SECTION_HEADING}[ \\t]*\\n`, "g");

/**
 * 지침 끝의 "## 실행 대상" 절을 실행 규칙과 대상으로 나눈다.
 * 절 안에 만들기 시트가 쓰지 않는 줄이 있으면 사용자가 쓴 내용으로 보고 지침을 그대로 둔다.
 */
export function parseSkillInstructions(markdown: string): ParsedSkillInstructions {
  const untouched: ParsedSkillInstructions = { rules: markdown.trim(), targets: [], hasTargetSection: false };
  const matches = [...markdown.matchAll(SECTION_PATTERN)];
  const last = matches.at(-1);
  if (last?.index == null) return untouched;

  const lines = markdown
    .slice(last.index + last[0].length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const knownLines = new Set<string>([...Object.values(TARGET_INSTRUCTION_LINES), AUTO_RESULT_INSTRUCTION]);
  if (lines.length === 0 || lines.some((line) => !knownLines.has(line))) return untouched;

  return {
    rules: markdown.slice(0, last.index).trim(),
    targets: SKILL_TARGET_OPTIONS.map((option) => option.value).filter((target) =>
      lines.includes(TARGET_INSTRUCTION_LINES[target])
    ),
    hasTargetSection: true
  };
}

/** 스킬 응답 → 상세 시트 초기값. 켜진 버전이 있으면 그 버전을, 없으면 최신 버전을 보여 준다. */
export function skillDetailForm(skill: SkillResponse): SkillDetailForm {
  const version = skill.enabled_version ?? skill.latest_version;
  const kindAndResult = kindFromCapabilities(version?.capabilities ?? []);
  return {
    kind: kindAndResult?.kind ?? null,
    resultMode: kindAndResult?.resultMode ?? INITIAL_SKILL_CREATE_FORM.resultMode,
    scope: skill.scope_type === "personal" ? "personal" : "team",
    command: skill.slug,
    description: version?.description ?? "",
    ...parseSkillInstructions(version?.instructions_markdown ?? "")
  };
}

/** 상세 입력값 → 저장할 instructions_markdown. 대상 절은 만들기 시트와 같은 형식으로 다시 붙인다. */
export function skillDetailInstructions(form: SkillDetailForm): string {
  const rules = form.rules.trim();
  if (form.kind == null || !isDocumentKind(form.kind)) return rules;
  if (!form.hasTargetSection && form.targets.length === 0) return rules;
  return composeSkillInstructions({ kind: form.kind, resultMode: form.resultMode, targets: form.targets, rules });
}

/** 상세 입력값 → 목록 훅의 수정 초안(skillUpdateRequest 입력) */
export function skillDetailDraft(form: SkillDetailForm): { description: string; instructionsMarkdown: string } {
  return { description: form.description.trim(), instructionsMarkdown: skillDetailInstructions(form) };
}

export type SkillDetailField = "description" | "rules";

export function validateSkillDetailForm(form: SkillDetailForm): Partial<Record<SkillDetailField, string>> {
  const errors: Partial<Record<SkillDetailField, string>> = {};
  const description = form.description.trim();
  if (description === "") errors.description = "설명을 입력해 주세요.";
  else if (description.length > SKILL_DESCRIPTION_MAX) {
    errors.description = `설명은 ${SKILL_DESCRIPTION_MAX}자까지 쓸 수 있습니다.`;
  }
  if (form.rules.trim() === "") errors.rules = "실행 규칙을 입력해 주세요.";
  else if (skillDetailInstructions(form).length > SKILL_INSTRUCTIONS_MAX) {
    errors.rules = `실행 규칙은 ${SKILL_INSTRUCTIONS_MAX.toLocaleString("ko-KR")}자까지 쓸 수 있습니다.`;
  }
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
 * AI 초안을 상세 시트에 채운다. 게시된 스킬의 종류·결과 방식은 PATCH로 바꿀 수 없어 실행 규칙만 바꾸고,
 * 설명은 비어 있을 때만 제안값으로 채운다. 초안에 "실행 대상" 절이 있으면 대상으로 되읽는다.
 */
export function applySkillDetailDraft(
  form: SkillDetailForm,
  draft: Pick<SkillAuthoringResult, "description" | "instructions_markdown">
): SkillDetailForm {
  const suggestedDescription = (draft.description ?? "").trim();
  const instructions = draft.instructions_markdown ?? "";
  const parsed = instructions.trim() ? parseSkillInstructions(instructions) : null;
  return {
    ...form,
    ...(parsed == null
      ? {}
      : parsed.hasTargetSection
        ? parsed
        : { rules: parsed.rules }),
    description: form.description.trim() === "" ? suggestedDescription.slice(0, SKILL_DESCRIPTION_MAX) : form.description
  };
}
