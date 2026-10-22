import type { SkillAuthoringResult, SkillExecutionOptions, SkillResponse } from "@/entities/skill/model/skill";
import {
  INITIAL_SKILL_CREATE_FORM,
  isDocumentKind,
  kindFromCapabilities,
  SKILL_DESCRIPTION_MAX,
  SKILL_INSTRUCTIONS_MAX,
  SKILL_TARGET_OPTIONS,
  showsSourceField,
  skillCapabilities,
  skillCommandError,
  skillExecutionOptions,
  targetsFromValues,
  TARGETS_REQUIRED_MESSAGE,
  type SkillCapability,
  type SkillCreateForm,
  type SkillKind,
  type SkillResultMode,
  type SkillScope,
  type SkillTarget
} from "./skillCreateForm";

/**
 * 스킬 상세 시트(Figma 1708:4059) 입력값.
 * 만들기 시트와 같은 스킬 종류·결과 방식·대상·(원문 문서) 필드와 저장범위·커맨드명·설명·실행 규칙을 둔다.
 * 종류·결과 방식은 버전의 capabilities·result_mode에서 읽고, 바꿔 저장하면 capabilities를 함께 보낸다(skillDetailDraft).
 * 저장범위는 PATCH가 받지 않아 읽기 전용이다. 테스트 실행 capability도 이 화면 값을 따른다(skillDetailAuthorForm).
 */
export interface SkillDetailForm {
  /** capabilities를 알 수 없으면 null(종류를 고르기 전까지 결과 방식·대상을 표시하지 않는다) */
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

export type SkillDetailDraft = {
  name: string;
  description: string;
  instructionsMarkdown: string;
  capabilities?: SkillCapability[];
} & SkillExecutionOptions;

/** 서버에 저장된 종류·결과 방식(켜진 버전, 없으면 최신 버전). 저장 때 바뀌었는지 비교하는 기준이다. */
export interface SavedSkillKind {
  capabilities: readonly string[];
  /** 저장된 결과 방식. 필드 추가 전 스킬이거나 문서 스킬이 아니면 null */
  resultMode: SkillResultMode | null;
  /** 시트를 열 때 보여 준 종류·결과 방식(skillDetailForm과 같은 규칙) */
  shown: Pick<SkillDetailForm, "kind" | "resultMode">;
}

function toSavedSkillKind(capabilities: readonly string[], resultMode: SkillResultMode | null): SavedSkillKind {
  const derived = kindFromCapabilities(capabilities);
  return {
    capabilities,
    resultMode,
    shown: { kind: derived?.kind ?? null, resultMode: resultMode ?? derived?.resultMode ?? INITIAL_SKILL_CREATE_FORM.resultMode }
  };
}

export function savedSkillKind(skill: SkillResponse): SavedSkillKind {
  const version = skill.enabled_version ?? skill.latest_version;
  return toSavedSkillKind(version?.capabilities ?? [], version?.result_mode ?? null);
}

/** 저장 응답 → 새 기준. 저장한 뒤 시트를 열어 둘 때(원문 문서 알림) 다음 저장의 비교 기준으로 쓴다. */
export function savedSkillKindFromResult(result: Pick<SkillAuthoringResult, "capabilities" | "result_mode">): SavedSkillKind {
  return toSavedSkillKind(result.capabilities ?? [], result.result_mode ?? null);
}

function sameCapabilities(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((capability) => b.includes(capability));
}

/**
 * 저장된 capabilities가 시트에서 고를 수 있는 조합 하나와 정확히 같은지.
 * 아니면(예: ["document-edit","folder-organize"]는 '폴더 정리'로 보인다) 잘못 저장된 조합이다.
 */
function isCanonicalCapabilities(capabilities: readonly string[]): boolean {
  const derived = kindFromCapabilities(capabilities);
  return derived != null && sameCapabilities(skillCapabilities(derived.kind, derived.resultMode), capabilities);
}

/**
 * 저장할 때 보낼 capabilities. 보내지 않으면 null(서버가 이전 값을 이어받는다).
 * - 사용자가 종류를 바꿨거나 문서 스킬의 결과 방식을 바꿨으면 화면 값으로 만든 capabilities를 보낸다.
 * - 저장된 조합이 잘못됐으면(isCanonicalCapabilities) 바꾸지 않았어도 화면에 보이는 종류로 보내 바로잡는다.
 * - 종류를 알 수 없고(null) 사용자가 고르지도 않았으면 보내지 않는다.
 */
export function detailCapabilitiesChange(form: Pick<SkillDetailForm, "kind" | "resultMode">, saved: SavedSkillKind): SkillCapability[] | null {
  if (form.kind == null) return null;
  const isChanged = form.kind !== saved.shown.kind || (isDocumentKind(form.kind) && form.resultMode !== saved.shown.resultMode);
  if (!isChanged && isCanonicalCapabilities(saved.capabilities)) return null;
  return skillCapabilities(form.kind, form.resultMode);
}

/**
 * 상세 입력값 → 목록 훅의 수정 초안(skillUpdateRequest 입력). 커맨드명은 name으로 보내 slug를 바꾼다.
 * - capabilities: 종류·결과 방식을 바꿨거나 저장된 조합이 잘못됐을 때만 보낸다(detailCapabilitiesChange).
 *   생략하면 서버가 이전 값을 이어받는다.
 * - 문서 스킬이면 targets와 result_mode를 함께 보내 실행 규칙만 고친 저장이 종류를 바꾸지 않게 한다.
 *   result_mode는 화면 값이다. 저장값이 없는 예전 스킬은 종류·결과 방식을 바꾸지 않은 저장에서 보내지 않는다
 *   (결과 방식 없음(null)을 바꾸지 않게).
 * - requires_source: '원문 문서' 필드가 보이면 화면 값을 그대로 보낸다(빼면 서버가 지침으로 다시 정할 수 있다).
 * 폴더 정리·템플릿처럼 문서 스킬이 아니면 targets·result_mode·requires_source를 빼고 보낸다(보내면 400).
 */
export function skillDetailDraft(form: SkillDetailForm, saved: SavedSkillKind): SkillDetailDraft {
  const capabilities = detailCapabilitiesChange(form, saved);
  const options = form.kind == null ? {} : skillExecutionOptions(form.kind, form.resultMode, form.targets);
  const sendsResultMode = capabilities != null || saved.resultMode != null;
  return {
    name: form.command.trim(),
    description: form.description.trim(),
    instructionsMarkdown: form.rules.trim(),
    ...(capabilities != null ? { capabilities } : {}),
    ...(options.targets != null ? { targets: options.targets } : {}),
    ...(options.result_mode != null && sendsResultMode ? { result_mode: options.result_mode } : {}),
    ...(showsDetailSourceField(form) ? { requires_source: form.requiresSource as boolean } : {})
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

export type SkillDetailField = "command" | "description" | "rules" | "targets";

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
  if (form.kind === "document" && form.targets.length === 0) errors.targets = TARGETS_REQUIRED_MESSAGE;
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
