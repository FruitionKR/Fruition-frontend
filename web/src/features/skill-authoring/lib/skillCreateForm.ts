import type {
  SkillAuthoringRequest,
  SkillAuthoringResult,
  SkillExecutionOptions,
  SkillPublishRequest,
  SkillTargetValue
} from "@/entities/skill/model/skill";

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

export const SKILL_KIND_LABELS: Record<SkillKind, string> = {
  document: "문서",
  folder: "폴더 정리",
  template: "템플릿"
};

/**
 * 스킬 만들기에서 고르는 종류 카드는 문서·폴더 정리 두 가지다(디자인 '② 새 스킬 탭').
 * 템플릿 capability는 새로 만들 수 없고, 예전에 만든 템플릿 스킬을 열 때만 읽기 전용으로 보여 준다.
 */
export const SKILL_KIND_CARDS: ReadonlyArray<{ value: Exclude<SkillKind, "template">; label: string; description: string }> = [
  { value: "document", label: "문서", description: "새 문서를 만들거나 열린 문서를 고칩니다. 미리보기로 확인한 뒤 저장돼요." },
  { value: "folder", label: "폴더 정리", description: "폴더·문서 트리 항목을 만들고, 이름을 바꾸고, 옮깁니다. 승인한 항목만 저장돼요." }
];

export const SKILL_RESULT_OPTIONS: ReadonlyArray<{ value: SkillResultMode; label: string }> = [
  { value: "create", label: "새 문서로 만들기" },
  { value: "edit", label: "열린 문서 고치기" },
  { value: "auto", label: "상황에 맞게" }
];

export const SKILL_TARGET_OPTIONS: ReadonlyArray<{ value: SkillTarget; label: string }> = [
  { value: "current-document", label: "현재 문서" },
  { value: "selection", label: "선택한 부분" }
];

export const SKILL_SCOPE_OPTIONS: ReadonlyArray<{ value: SkillScope; label: string }> = [
  { value: "personal", label: "개인" },
  { value: "team", label: "팀" }
];

export interface SkillCreateForm {
  kind: SkillKind;
  resultMode: SkillResultMode;
  targets: readonly SkillTarget[];
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

/** 실행 규칙 아래 안내 (디자인 문구 그대로). 자리표시자 치환은 실행 쪽(AI pipeline)이 맡는다. */
export const RULES_PLACEHOLDER_HINT = "{문서}, {선택한 부분}, {요청} 을 넣으면 실행할 때 채워집니다.";

/** 실행 규칙 안내 문구. 폴더 정리 스킬은 문서·선택한 부분을 받지 않으므로 자리표시자 안내를 감춘다(null). */
export function rulesPlaceholderHint(kind: SkillKind | null): string | null {
  return kind === "folder" ? null : RULES_PLACEHOLDER_HINT;
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

const TARGET_VALUES: Record<SkillTarget, SkillTargetValue> = {
  "current-document": "current_document",
  selection: "selection"
};

/** 서버 targets 값 → 시트 대상. 모르는 값은 버리고 순서는 시트 옵션 순서로 맞춘다. */
export function targetsFromValues(values: readonly string[]): SkillTarget[] {
  return SKILL_TARGET_OPTIONS.map((option) => option.value).filter((target) => values.includes(TARGET_VALUES[target]));
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
    targets: SKILL_TARGET_OPTIONS.filter((option) => targets.includes(option.value)).map((option) => TARGET_VALUES[option.value]),
    result_mode: resultMode
  };
}

/** 시트 입력값 → POST /skills/author/publish 요청. allowed_tools는 서버가 capabilities로 계산한다(ai#121). */
export function skillPublishRequest(form: SkillCreateForm): SkillPublishRequest {
  return {
    name: form.command.trim(),
    description: form.description.trim(),
    instructions_markdown: form.rules.trim(),
    scope_type: form.scope,
    capabilities: skillCapabilities(form.kind, form.resultMode),
    ...skillExecutionOptions(form.kind, form.resultMode, form.targets)
  };
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
 */
export function applySkillDraft(
  form: SkillCreateForm,
  draft: Pick<SkillAuthoringResult, "name" | "description" | "instructions_markdown" | "capabilities">
): SkillCreateForm {
  const suggestedName = (draft.name ?? "").trim();
  const suggestedDescription = (draft.description ?? "").trim();
  const drafted = kindFromCapabilities(draft.capabilities ?? []);
  return {
    ...form,
    // 템플릿은 만들기에서 고를 수 없는 종류라, AI가 템플릿을 골라도 지금 고른 종류를 유지한다.
    ...(drafted != null && drafted.kind !== "template" ? drafted : {}),
    rules: draft.instructions_markdown?.trim() ? draft.instructions_markdown : form.rules,
    command: form.command.trim() === "" && SKILL_NAME_PATTERN.test(suggestedName) ? suggestedName : form.command,
    description: form.description.trim() === "" ? suggestedDescription.slice(0, SKILL_DESCRIPTION_MAX) : form.description
  };
}

export type SkillCreateField = "command" | "description" | "rules" | "targets";

export const TARGETS_REQUIRED_MESSAGE = "대상을 하나 이상 골라 주세요.";

/** 커맨드명(→ name·slug) 오류 문구. 문제가 없으면 null. 만들기·상세 시트가 같이 쓴다. */
export function skillCommandError(value: string, existingSlugs: readonly string[]): string | null {
  const command = value.trim();
  if (command === "") return "커맨드명을 입력해 주세요.";
  if (!SKILL_NAME_PATTERN.test(command)) return "커맨드는 영문 소문자·숫자·하이픈만 사용할 수 있습니다. (예: meeting-summary)";
  if (existingSlugs.includes(command)) return "이미 사용 중인 커맨드입니다. 다른 커맨드 이름을 입력해 주세요.";
  return null;
}

/** 필드별 오류 문구. 오류가 없으면 빈 객체다. */
export function validateSkillCreateForm(
  form: SkillCreateForm,
  existingSlugs: readonly string[]
): Partial<Record<SkillCreateField, string>> {
  const errors: Partial<Record<SkillCreateField, string>> = {};
  const commandError = skillCommandError(form.command, existingSlugs);
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
  if (isDocumentKind(form.kind) && form.targets.length === 0) errors.targets = TARGETS_REQUIRED_MESSAGE;
  return errors;
}
