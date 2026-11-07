import type {
  SkillAuthoringRequest,
  SkillAuthoringResult,
  SkillExecutionOptions,
  SkillPublishRequest,
  SkillTargetValue
} from "@/entities/skill/model/skill";
import type { SkillsTranslate } from "./skillsTranslate";

/**
 * 스킬 만들기 탭 입력값과 게시 요청 변환.
 * 스킬 종류·결과 방식은 capabilities로, 문서 스킬의 결과 방식·대상은 result_mode·targets로 보낸다.
 */

export const SKILL_NAME_MAX = 63;
export const SKILL_DESCRIPTION_MAX = 500;
export const SKILL_INSTRUCTIONS_MAX = 30_000;
// 서버 name 검증 패턴 (Fruition-document SkillPublishRequest)
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export type SkillKind = "document" | "folder" | "template";
export type SkillResultMode = "create" | "edit" | "auto";
export type SkillTarget = "current-document" | "selection";
export type SkillScope = "personal" | "team";
export type SkillCapability = "document-create" | "document-edit" | "folder-organize" | "template";

/**
 * 스킬 만들기에서 고르는 종류 카드는 문서·폴더 정리 두 가지다(디자인 '② 새 스킬 탭').
 * 템플릿 capability는 새로 만들 수 없고, 예전에 만든 템플릿 스킬을 열 때만 읽기 전용으로 보여 준다.
 * 이름·설명은 skills 메시지(kinds·kindDescriptions)에 둔다.
 */
export const SKILL_KIND_CARDS: readonly Exclude<SkillKind, "template">[] = ["document", "folder"];

/** 결과 방식 선택지 순서. 이름은 skills 메시지(resultModes)에 둔다. */
export const SKILL_RESULT_MODES: readonly SkillResultMode[] = ["create", "edit", "auto"];

/** 대상 선택지 순서. 이름은 skills 메시지(targets)에 둔다. */
export const SKILL_TARGETS: readonly SkillTarget[] = ["current-document", "selection"];

/** 저장범위 선택지 순서. 이름은 skills 메시지(scopes)에 둔다. */
export const SKILL_SCOPES: readonly SkillScope[] = ["personal", "team"];

/** 원문 문서: read=읽음, skip=읽지 않음 (requires_source true/false) */
export type SkillSourceChoice = "read" | "skip";

export const SKILL_SOURCE_CHOICES: readonly SkillSourceChoice[] = ["read", "skip"];

const TARGET_MESSAGE_KEYS = { "current-document": "currentDocument", selection: "selection" } as const;

export function skillKindLabel(kind: SkillKind, t: SkillsTranslate): string {
  return t(`kinds.${kind}`);
}

export function skillTargetLabel(target: SkillTarget, t: SkillsTranslate): string {
  return t(`targets.${TARGET_MESSAGE_KEYS[target]}`);
}

export function skillScopeLabel(scope: SkillScope, t: SkillsTranslate): string {
  return t(`scopes.${scope}`);
}

/** 원문 문서를 아직 정하지 않았을 때(만들기 시트에서 고르기 전) 선택 상자에 보이는 문구 */
export function sourceUnsetLabel(t: SkillsTranslate): string {
  return t("sources.unset");
}

export interface SkillCreateForm {
  kind: SkillKind;
  resultMode: SkillResultMode;
  targets: readonly SkillTarget[];
  /**
   * 원문 문서 필요 여부(requires_source). 'AI로 작성' 초안이 정한 값이나 사용자가 고른 값이다.
   * null이면 보내지 않아 서버가 규칙으로만 정한다(지침에 {문서}가 있으면 읽음, 아니면 읽지 않음). 게시는 다시 분류하지 않는다.
   */
  requiresSource: boolean | null;
  scope: SkillScope;
  command: string;
  description: string;
  rules: string;
}

/**
 * 결과 방식 기본값은 '상황에 맞게'다. 실행 규칙이 "고친다"인데 '새 문서로 만들기'로 게시되는 일을 막고,
 * 새 문서·현재 문서 수정 중 무엇을 할지는 서버가 정한다(테스트 실행도 수정 결과로 보여 준다).
 */
export const INITIAL_SKILL_CREATE_FORM: SkillCreateForm = {
  kind: "document",
  resultMode: "auto",
  targets: ["current-document"],
  requiresSource: null,
  scope: "personal",
  command: "",
  description: "",
  rules: ""
};

/**
 * Agent 대화의 요청으로 새 스킬을 열 때의 초기값. 요청 문장을 실행 규칙에 채워 두고 사용자가 필요한 부분만 고친다.
 */
export function skillCreateFormFromRequest(request: string): SkillCreateForm {
  return { ...INITIAL_SKILL_CREATE_FORM, rules: request.trim() };
}

/**
 * 실행 규칙 안내 문구(디자인 문구 그대로). 폴더 정리 스킬은 문서·선택한 부분을 받지 않으므로 자리표시자 안내를 감춘다(null).
 * 자리표시자 이름({문서} 등)은 실행 쪽(AI pipeline)이 치환하는 그대로라 언어와 상관없이 같다.
 */
export function rulesPlaceholderHint(kind: SkillKind | null, t: SkillsTranslate): string | null {
  return kind === "folder" ? null : t("form.rulesHint");
}

/** 결과 방식·대상은 문서 스킬에만 의미가 있다(폴더 정리·템플릿은 capability 하나로 정해진다). */
export function isDocumentKind(kind: SkillKind): boolean {
  return kind === "document";
}

/** 스킬 종류·결과 방식 → capability. '상황에 맞게'는 새 문서·현재 문서 수정을 모두 허용한다. */
export function skillCapabilities(kind: SkillKind, resultMode: SkillResultMode): SkillCapability[] {
  if (kind === "folder") return ["folder-organize"];
  if (kind === "template") return ["template"];
  if (resultMode === "create") return ["document-create"];
  if (resultMode === "edit") return ["document-edit"];
  return ["document-create", "document-edit"];
}

/**
 * '원문 문서' 필드를 보여 줄지. 새 문서를 만들 수 있는 문서 스킬('새 문서로 만들기'·'상황에 맞게')에만 의미가 있다.
 * '열린 문서 고치기'·폴더 정리·템플릿(늘 원문 없음)은 감춘다.
 */
export function showsSourceField(kind: SkillKind | null, resultMode: SkillResultMode): boolean {
  return kind === "document" && resultMode !== "edit";
}

export function sourceChoice(requiresSource: boolean | null): SkillSourceChoice | null {
  if (requiresSource == null) return null;
  return requiresSource ? "read" : "skip";
}

export function requiresSourceFromChoice(choice: SkillSourceChoice): boolean {
  return choice === "read";
}

/**
 * '원문 문서' 아래 안내. 정하지 않았으면(null) 게시할 때 적용되는 규칙을 알린다.
 * 게시는 의도를 다시 분류하지 않아, 고르지 않으면 {문서} 자리표시자가 있을 때만 원문을 읽는다(ai skills.md).
 */
export function sourceHint(requiresSource: boolean | null, t: SkillsTranslate): string {
  if (requiresSource == null) return t("sourceHint.unset");
  return requiresSource ? t("sourceHint.read") : t("sourceHint.skip");
}

/** 원문 문서 값 → 화면 라벨('읽음'·'읽지 않음') */
export function sourceLabel(requiresSource: boolean, t: SkillsTranslate): string {
  return t(`sources.${sourceChoice(requiresSource) ?? "skip"}`);
}

const TARGET_VALUES: Record<SkillTarget, SkillTargetValue> = {
  "current-document": "current_document",
  selection: "selection"
};

/** 서버 targets 값 → 시트 대상. 모르는 값은 버리고 순서는 시트 옵션 순서로 맞춘다. */
export function targetsFromValues(values: readonly string[]): SkillTarget[] {
  return SKILL_TARGETS.filter((target) => values.includes(TARGET_VALUES[target]));
}

/**
 * 시트의 결과 방식·대상 → 게시·수정 요청의 targets·result_mode (ai#122).
 * 폴더 정리·템플릿 스킬은 두 필드를 보내면 서버가 400(invalid_targets/invalid_result_mode)으로 거절해 키를 뺀다.
 */
export function skillExecutionOptions(
  kind: SkillKind,
  resultMode: SkillResultMode,
  targets: readonly SkillTarget[]
): SkillExecutionOptions {
  if (!isDocumentKind(kind)) return {};
  return {
    targets: SKILL_TARGETS.filter((target) => targets.includes(target)).map((target) => TARGET_VALUES[target]),
    result_mode: resultMode
  };
}

/**
 * 시트 입력값 → POST /skills/author/publish 요청. allowed_tools는 서버가 capabilities로 계산한다(ai#121).
 * requires_source는 '원문 문서' 값이 있고(AI 초안이 정했거나 사용자가 골랐고) 그 필드가 보이는 스킬일 때만 보낸다.
 * 게시는 의도를 다시 분류하지 않으므로, 초안의 판단을 지키려면 사용자가 손대지 않았어도 보내야 한다. 빼면 {문서}·템플릿 규칙만 적용된다.
 */
export function skillPublishRequest(form: SkillCreateForm): SkillPublishRequest {
  return {
    name: form.command.trim(),
    description: form.description.trim(),
    instructions_markdown: form.rules.trim(),
    scope_type: form.scope,
    capabilities: skillCapabilities(form.kind, form.resultMode),
    ...skillExecutionOptions(form.kind, form.resultMode, form.targets),
    ...skillRequiresSourceOption(form)
  };
}

/** 게시·테스트 실행에 싣는 requires_source. '원문 문서' 값이 있고 그 필드가 보이는 스킬일 때만 담고, 아니면 키를 뺀다. */
export function skillRequiresSourceOption(form: SkillCreateForm): { requires_source?: boolean } {
  const sendsSource = form.requiresSource != null && showsSourceField(form.kind, form.resultMode);
  return sendsSource ? { requires_source: form.requiresSource as boolean } : {};
}

export type SkillAuthoringMode = "enhance" | "preserve" | "regenerate";

/**
 * 시트 입력값 → POST /skills/author 요청. 실행 규칙을 AI 지시문으로 보낸다.
 * 이름·설명은 서버 검증(패턴·500자)을 통과할 때만 보낸다. 잘못된 값을 보내면 400이 난다.
 */
export function skillAuthorRequest(
  form: SkillCreateForm,
  mode: SkillAuthoringMode,
  referenceDocumentIds: readonly string[]
): SkillAuthoringRequest {
  const name = form.command.trim();
  const description = form.description.trim();
  return {
    instruction: form.rules.trim(),
    authoring_mode: mode,
    scope_type: form.scope,
    ...(SKILL_NAME_PATTERN.test(name) ? { name } : {}),
    ...(description !== "" && description.length <= SKILL_DESCRIPTION_MAX ? { description } : {}),
    ...(referenceDocumentIds.length > 0 ? { reference_document_ids: [...referenceDocumentIds] } : {})
  };
}

/** AI가 고른 capability를 시트의 스킬 종류·결과 방식으로 되돌린다. 알 수 없으면 null(현재 선택 유지). */
export function kindFromCapabilities(
  capabilities: readonly string[]
): Pick<SkillCreateForm, "kind" | "resultMode"> | null {
  if (capabilities.includes("folder-organize")) return { kind: "folder", resultMode: "create" };
  if (capabilities.includes("template")) return { kind: "template", resultMode: "create" };
  const creates = capabilities.includes("document-create");
  const edits = capabilities.includes("document-edit");
  if (creates && edits) return { kind: "document", resultMode: "auto" };
  if (creates) return { kind: "document", resultMode: "create" };
  if (edits) return { kind: "document", resultMode: "edit" };
  return null;
}

/**
 * AI 초안을 시트에 채운다. 실행 규칙은 초안 지침으로 바꾸고(차단돼 지침이 없으면 유지),
 * 커맨드명·설명은 비어 있을 때만 제안값으로 채운다. 스킬 종류·결과 방식은 AI가 고른 capability를 따른다(템플릿 제외).
 * 원문 문서는 초안이 requires_source(boolean)를 주면 그 값으로 채운다. 게시에 그대로 실어 AI 판단을 지킨다.
 */
export function applySkillDraft(
  form: SkillCreateForm,
  draft: Pick<SkillAuthoringResult, "name" | "description" | "instructions_markdown" | "capabilities" | "requires_source">
): SkillCreateForm {
  const suggestedName = (draft.name ?? "").trim();
  const suggestedDescription = (draft.description ?? "").trim();
  const drafted = kindFromCapabilities(draft.capabilities ?? []);
  return {
    ...form,
    // 템플릿은 만들기에서 고를 수 없는 종류라, AI가 템플릿을 골라도 지금 고른 종류를 유지한다.
    ...(drafted != null && drafted.kind !== "template" ? drafted : {}),
    ...(typeof draft.requires_source === "boolean" ? { requiresSource: draft.requires_source } : {}),
    rules: draft.instructions_markdown?.trim() ? draft.instructions_markdown : form.rules,
    command: form.command.trim() === "" && SKILL_NAME_PATTERN.test(suggestedName) ? suggestedName : form.command,
    description: form.description.trim() === "" ? suggestedDescription.slice(0, SKILL_DESCRIPTION_MAX) : form.description
  };
}

/**
 * 안전 검토에 걸린 응답을 시트에 채운다. 이때의 원문 문서·종류·결과 방식은 AI의 판단으로 볼 수 없어 사용자가 고른 값을 유지한다
 * (blocked 응답도 requires_source:false를 실어 보낸다). 고칠 실행 규칙과 비어 있던 이름·설명 제안만 채운다.
 */
export function applyReviewedSkillDraft(
  form: SkillCreateForm,
  draft: Pick<SkillAuthoringResult, "name" | "description" | "instructions_markdown">
): SkillCreateForm {
  return applySkillDraft(form, { name: draft.name, description: draft.description, instructions_markdown: draft.instructions_markdown, capabilities: [] });
}

/** 결과 방식 값 → 화면 라벨('새 문서로 만들기' 등) */
export function skillResultModeLabel(mode: SkillResultMode, t: SkillsTranslate): string {
  return t(`resultModes.${mode}`);
}

/**
 * AI 초안을 채우며 문서 스킬의 결과 방식이 바뀌었으면 이전·이후 값, 아니면 null.
 * 사용자가 고른 값을 말없이 덮지 않도록, 바꾼 사실을 알리고 되돌릴 수 있게 하는 데 쓴다.
 */
export function draftResultModeChange(
  before: Pick<SkillCreateForm, "kind" | "resultMode">,
  after: Pick<SkillCreateForm, "kind" | "resultMode">
): { from: SkillResultMode; to: SkillResultMode } | null {
  if (!isDocumentKind(before.kind) || !isDocumentKind(after.kind) || before.resultMode === after.resultMode) return null;
  return { from: before.resultMode, to: after.resultMode };
}

/**
 * AI 초안을 채우며 '원문 문서' 값이 바뀌었으면 이전·이후 값, 아니면 null. 이전 값은 고르지 않음(null)일 수 있다.
 * 결과 방식처럼 AI가 정한 사실을 알리고 되돌릴 수 있게 한다. 필드가 보이지 않는 스킬(고치기·폴더 정리)은 알리지 않는다.
 */
export function draftSourceChange(
  before: Pick<SkillCreateForm, "requiresSource">,
  after: Pick<SkillCreateForm, "kind" | "resultMode" | "requiresSource">
): { from: boolean | null; to: boolean } | null {
  if (after.requiresSource == null || before.requiresSource === after.requiresSource) return null;
  if (!showsSourceField(after.kind, after.resultMode)) return null;
  return { from: before.requiresSource, to: after.requiresSource };
}

export type SkillCreateField = "command" | "description" | "rules" | "targets";

/**
 * 필드 오류. skills 메시지 validation 아래 키이고, 길이 초과는 한도(max)를 함께 넘긴다.
 * 화면은 t(`validation.${error.key}`, { max: error.max })로 현재 언어 문구를 만든다.
 */
export type SkillFieldError =
  | { key: "targetsRequired" | "commandRequired" | "commandPattern" | "commandTaken" | "descriptionRequired" | "rulesRequired" }
  | { key: "descriptionTooLong" | "rulesTooLong"; max: number };

export const TARGETS_REQUIRED_ERROR: SkillFieldError = { key: "targetsRequired" };

/** 필드 오류 → 현재 언어 문구 */
export function skillFieldErrorText(error: SkillFieldError, t: SkillsTranslate): string {
  return "max" in error ? t(`validation.${error.key}`, { max: error.max }) : t(`validation.${error.key}`);
}

/** 커맨드명(→ name·slug) 오류. 문제가 없으면 null. 만들기·상세 시트가 같이 쓴다. */
export function skillCommandError(value: string, existingSlugs: readonly string[]): SkillFieldError | null {
  const command = value.trim();
  if (command === "") return { key: "commandRequired" };
  if (!SKILL_NAME_PATTERN.test(command)) return { key: "commandPattern" };
  if (existingSlugs.includes(command)) return { key: "commandTaken" };
  return null;
}

/** 필드별 오류. 오류가 없으면 빈 객체다. */
export function validateSkillCreateForm(
  form: SkillCreateForm,
  existingSlugs: readonly string[]
): Partial<Record<SkillCreateField, SkillFieldError>> {
  const errors: Partial<Record<SkillCreateField, SkillFieldError>> = {};
  const commandError = skillCommandError(form.command, existingSlugs);
  if (commandError != null) errors.command = commandError;
  const description = form.description.trim();
  if (description === "") errors.description = { key: "descriptionRequired" };
  else if (description.length > SKILL_DESCRIPTION_MAX) {
    errors.description = { key: "descriptionTooLong", max: SKILL_DESCRIPTION_MAX };
  }
  if (form.rules.trim() === "") errors.rules = { key: "rulesRequired" };
  else if (form.rules.trim().length > SKILL_INSTRUCTIONS_MAX) {
    errors.rules = { key: "rulesTooLong", max: SKILL_INSTRUCTIONS_MAX };
  }
  if (isDocumentKind(form.kind) && form.targets.length === 0) errors.targets = TARGETS_REQUIRED_ERROR;
  return errors;
}
