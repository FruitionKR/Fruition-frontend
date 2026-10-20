import type { SkillAuthoringResult, SkillExecutionOptions, SkillResponse } from "@/entities/skill/model/skill";
import {
  INITIAL_SKILL_CREATE_FORM,
  kindFromCapabilities,
  SKILL_DESCRIPTION_MAX,
  SKILL_INSTRUCTIONS_MAX,
  SKILL_TARGET_OPTIONS,
  showsSourceField,
  skillCommandError,
  skillExecutionOptions,
  targetsFromValues,
  type SkillCreateForm,
  type SkillKind,
  type SkillResultMode,
  type SkillScope,
  type SkillTarget
} from "./skillCreateForm";

/**
 * 스킬 상세 시트(Figma 1708:4059) 입력값.
 * 화면에는 저장범위·커맨드명·설명·실행 규칙만 둔다. 저장할 때는 커맨드명(name)·설명·지침과, 문서 스킬이면 읽어 둔 대상을 그대로 보낸다.
 * 저장범위는 PATCH가 받지 않아 읽기 전용이다. 결과 방식은 처음 저장할 때 보내지 않는다(서버가 기존 값을 이어받는다).
 * 지침을 다시 분류한 capabilities와 이어받은 값이 맞지 않아 거절되면, 그때 결과 방식을 고르게 해 실어 보낸다.
 * 대상·결과 방식·스킬 종류는 화면에 두지 않지만 테스트 실행 capability를 정하려고 버전의 targets·result_mode·capabilities에서 읽는다(ai#122).
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
  /**
   * 원문 문서 필요 여부(requires_source). 서버가 이 필드를 주지 않으면(구버전 백엔드) null이고 '원문 문서' 필드를 감춘다.
   * 필드는 새 문서를 만들 수 있는 문서 스킬에만 보인다(showsSourceField).
   */
  requiresSource: boolean | null;
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
    targets: legacyTargets ?? (storedTargets.length > 0 ? storedTargets : INITIAL_SKILL_CREATE_FORM.targets),
    requiresSource: typeof version?.requires_source === "boolean" ? version.requires_source : null
  };
}

/** 상세 시트에 '원문 문서' 필드를 보여 줄지. 서버 값이 있고 새 문서를 만들 수 있는 문서 스킬일 때만이다. */
export function showsDetailSourceField(form: Pick<SkillDetailForm, "kind" | "resultMode" | "requiresSource">): boolean {
  return form.requiresSource != null && showsSourceField(form.kind, form.resultMode);
}

export type SkillDetailDraft = { name: string; description: string; instructionsMarkdown: string } & SkillExecutionOptions;

/**
 * 상세 입력값 → 목록 훅의 수정 초안(skillUpdateRequest 입력). 커맨드명은 name으로 보내 slug를 바꾼다.
 * 문서 스킬이면 읽어 둔 대상(targets)을 함께 보낸다(이전 형식 "실행 대상" 절을 뗀 스킬은 이걸로 대상이 남는다).
 * 결과 방식은 보통 보내지 않는다(생략하면 서버가 기존 값을 유지한다, ai#122).
 * 이어받은 값이든 명시한 값이든 서버가 지침을 다시 분류한 capabilities와 맞지 않으면 400으로 저장이 실패한다.
 * resultMode는 그렇게 거절됐거나(구버전 백엔드는 비워서 저장한다, resultModeDrift) 사용자가 다시 고른 값이다.
 * 문서 스킬일 때만 담는다.
 */
export function skillDetailDraft(
  form: SkillDetailForm,
  resultMode?: SkillResultMode,
  savedRequiresSource: boolean | null = form.requiresSource
): SkillDetailDraft {
  const targets = form.kind == null ? undefined : skillExecutionOptions(form.kind, form.resultMode, form.targets).targets;
  // 원문 문서는 사용자가 저장된 값에서 바꿨을 때만 보낸다. 빼면 서버가 정한다(지침을 고치면 AI가 다시 정할 수 있다).
  const sendsSource = showsDetailSourceField(form) && form.requiresSource !== savedRequiresSource;
  return {
    name: form.command.trim(),
    description: form.description.trim(),
    instructionsMarkdown: form.rules.trim(),
    ...(targets != null ? { targets } : {}),
    ...(targets != null && resultMode != null ? { result_mode: resultMode } : {}),
    ...(sendsSource ? { requires_source: form.requiresSource as boolean } : {})
  };
}

/**
 * 원문 문서를 보내지 않은 저장에서 서버(AI)가 값을 바꿨는지 본다. 사용자가 예상한 값(저장 전 값, from)과 다르면
 * 이전·이후 값을 돌려줘 시트에 알리고 되돌릴 수 있게 한다. 직접 골라 보냈거나, 값이 없거나, 같으면 null이다.
 * 다시 분류된 스킬이 새 문서를 만들지 않으면('열린 문서 고치기'·폴더 정리·템플릿) 필드가 없어 알리지 않는다.
 */
export function requiresSourceDrift(
  from: boolean | null,
  sent: boolean | undefined,
  result: Pick<SkillAuthoringResult, "capabilities" | "result_mode" | "requires_source">
): { from: boolean; to: boolean } | null {
  if (sent !== undefined || from == null || typeof result.requires_source !== "boolean" || result.requires_source === from) return null;
  const reclassified = kindFromCapabilities(result.capabilities ?? []);
  if (reclassified == null || !showsSourceField(reclassified.kind, result.result_mode ?? reclassified.resultMode)) return null;
  return { from, to: result.requires_source };
}

/**
 * 저장 응답에서 결과 방식이 사라졌는지 본다. 지금 AI는 이어받은 result_mode가 다시 분류한 capabilities와 맞지 않으면
 * 저장을 거절한다(invalid_result_mode → resultModeAfterRejection). 이전 AI는 거절하지 않고 null로 버렸으므로(ai#122)
 * 그런 백엔드와 붙을 때를 위해 남겨 둔다. 버려졌으면 저장 전 값(from)과 새 capabilities에 맞는 값(to)을, 아니면 null을 돌려준다.
 * 다시 분류된 스킬이 문서 스킬이 아니게 됐으면(결과 방식이 없는 종류) null이다.
 */
export function resultModeDrift(
  skill: SkillResponse,
  result: Pick<SkillAuthoringResult, "capabilities" | "result_mode">
): { from: SkillResultMode; to: SkillResultMode } | null {
  const from = (skill.enabled_version ?? skill.latest_version)?.result_mode;
  if (from == null || result.result_mode != null) return null;
  const reclassified = kindFromCapabilities(result.capabilities ?? []);
  if (reclassified == null || reclassified.kind !== "document") return null;
  return { from, to: reclassified.resultMode };
}

/**
 * 결과 방식 불일치로 저장이 거절됐을 때 먼저 골라 둘 결과 방식. 거절 응답에는 새 capabilities가 없어 저장 전 값으로 짐작한다.
 * 이어받은 값이 맞지 않았다는 건 그 capability가 빠졌다는 뜻이다:
 * '열린 문서 고치기'가 거절되면 고치기가 빠져 '새 문서로 만들기'만, '새 문서로 만들기'가 거절되면 '열린 문서 고치기'만 남았다고 본다.
 * '상황에 맞게'(둘 다)가 거절되면 둘 중 하나만 남았는데 어느 쪽인지 알 수 없어, 문서를 새로 만들지 않는 '열린 문서 고치기'를 고른다.
 * 저장 전 값도 목록에 남아 있어 사용자가 바꿀 수 있다.
 */
export function resultModeAfterRejection(current: SkillResultMode): SkillResultMode {
  if (current === "edit") return "create";
  return "edit";
}

export type SkillDetailField = "command" | "description" | "rules";

/** 필드별 오류 문구. otherSlugs는 이 스킬을 뺀 다른 스킬의 커맨드다. */
export function validateSkillDetailForm(
  form: SkillDetailForm,
  otherSlugs: readonly string[]
): Partial<Record<SkillDetailField, string>> {
  const errors: Partial<Record<SkillDetailField, string>> = {};
  const commandError = skillCommandError(form.command, otherSlugs);
  if (commandError != null) errors.command = commandError;
  const description = form.description.trim();
  if (description === "") errors.description = "설명을 입력해 주세요.";
  else if (description.length > SKILL_DESCRIPTION_MAX) {
    errors.description = `설명은 ${SKILL_DESCRIPTION_MAX}자까지 쓸 수 있습니다.`;
  }
  if (form.rules.trim() === "") errors.rules = "실행 규칙을 입력해 주세요.";
  else if (form.rules.trim().length > SKILL_INSTRUCTIONS_MAX) {
    errors.rules = `실행 규칙은 ${SKILL_INSTRUCTIONS_MAX.toLocaleString("ko-KR")}자까지 쓸 수 있습니다.`;
  }
  return errors;
}

/** 테스트 실행 카드에 넘길 만들기 시트 모양 입력값 */
export function skillDetailAuthorForm(form: SkillDetailForm): SkillCreateForm {
  return {
    ...INITIAL_SKILL_CREATE_FORM,
    ...(form.kind != null ? { kind: form.kind, resultMode: form.resultMode } : {}),
    targets: form.targets,
    requiresSource: form.requiresSource,
    scope: form.scope,
    command: form.command,
    description: form.description,
    rules: form.rules
  };
}
