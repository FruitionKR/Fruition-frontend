import type { SkillPublishRequest } from "@/entities/skill/model/skill";

/**
 * 스킬 만들기 시트(Figma 1671:14199) 입력값과 게시 요청 변환.
 * 시트의 선택값은 백엔드 SkillPublishRequest의 capabilities·allowed_tools·instructions_markdown으로 옮긴다.
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

export const SKILL_KIND_OPTIONS: ReadonlyArray<{ value: SkillKind; label: string }> = [
  { value: "document", label: "문서" },
  { value: "folder", label: "폴더 정리" },
  { value: "template", label: "템플릿" }
];

export const SKILL_RESULT_OPTIONS: ReadonlyArray<{ value: SkillResultMode; label: string }> = [
  { value: "create", label: "새 문서로 만들기" },
  { value: "edit", label: "현재 문서 수정" },
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

export const INITIAL_SKILL_CREATE_FORM: SkillCreateForm = {
  kind: "document",
  resultMode: "create",
  targets: ["current-document"],
  scope: "personal",
  command: "",
  description: "",
  rules: ""
};

// AI 서버 capability별 canonical Tool 집합 (Fruition-ai pipeline/app/modules/skill/domain/policy.py CAPABILITY_TOOLS).
// 게시 API가 allowed_tools를 필수로 받아, 사용자가 고른 capability의 Tool 합집합을 그대로 보낸다.
const PLANNING_READ_TOOLS = ["list_root_items", "list_folder_children"];
const DOCUMENT_READ_TOOLS = ["get_document_metadata", "get_document_content"];
const CAPABILITY_TOOLS: Record<SkillCapability, readonly string[]> = {
  "document-create": [...PLANNING_READ_TOOLS, ...DOCUMENT_READ_TOOLS, "create_document"],
  "document-edit": [...PLANNING_READ_TOOLS, ...DOCUMENT_READ_TOOLS, "apply_document_edit"],
  "folder-organize": [
    ...PLANNING_READ_TOOLS,
    "search_hierarchy",
    "get_breadcrumb",
    ...DOCUMENT_READ_TOOLS,
    "create_folder",
    "rename_folder",
    "move_folder",
    "move_document",
    "rename_document"
  ],
  template: [...PLANNING_READ_TOOLS, ...DOCUMENT_READ_TOOLS, "create_document", "apply_document_edit"]
};

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

/** capability들의 Tool 합집합(중복 제거, 서버가 중복을 거절한다). */
export function skillAllowedTools(capabilities: readonly SkillCapability[]): string[] {
  return [...new Set(capabilities.flatMap((capability) => CAPABILITY_TOOLS[capability]))];
}

const TARGET_INSTRUCTION_LINES: Record<SkillTarget, string> = {
  "current-document": "- 현재 문서",
  selection: "- 사용자가 선택한 부분 (선택한 부분이 있으면 그 부분만 다룬다)"
};
const AUTO_RESULT_INSTRUCTION = "- 새 문서로 만들지 현재 문서를 고칠지 대상이 애매하면 먼저 사용자에게 되묻는다.";

/**
 * 실행 규칙 + 대상·결과 방식 안내를 instructions_markdown으로 합친다.
 * 대상은 백엔드에 별도 필드가 없어 Agent가 읽는 지침의 "실행 대상" 절로 남긴다.
 */
export function composeSkillInstructions(form: Pick<SkillCreateForm, "kind" | "resultMode" | "targets" | "rules">): string {
  const rules = form.rules.trim();
  if (!isDocumentKind(form.kind)) return rules;
  const lines = SKILL_TARGET_OPTIONS.filter((option) => form.targets.includes(option.value)).map(
    (option) => TARGET_INSTRUCTION_LINES[option.value]
  );
  if (form.resultMode === "auto") lines.push(AUTO_RESULT_INSTRUCTION);
  if (lines.length === 0) return rules;
  return `${rules}\n\n## 실행 대상\n\n${lines.join("\n")}`;
}

/** 시트 입력값 → POST /skills/author/publish 요청 */
export function skillPublishRequest(form: SkillCreateForm): SkillPublishRequest {
  const capabilities = skillCapabilities(form.kind, form.resultMode);
  return {
    name: form.command.trim(),
    description: form.description.trim(),
    instructions_markdown: composeSkillInstructions(form),
    scope_type: form.scope,
    capabilities,
    allowed_tools: skillAllowedTools(capabilities)
  };
}

export type SkillCreateField = "command" | "description" | "rules";

/** 필드별 오류 문구. 오류가 없으면 빈 객체다. */
export function validateSkillCreateForm(
  form: SkillCreateForm,
  existingSlugs: readonly string[]
): Partial<Record<SkillCreateField, string>> {
  const errors: Partial<Record<SkillCreateField, string>> = {};
  const command = form.command.trim();
  if (command === "") errors.command = "커맨드명을 입력해 주세요.";
  else if (!SKILL_NAME_PATTERN.test(command)) {
    errors.command = "커맨드는 영문 소문자·숫자·하이픈만 사용할 수 있습니다. (예: meeting-summary)";
  } else if (existingSlugs.includes(command)) {
    errors.command = "이미 사용 중인 커맨드입니다. 다른 커맨드 이름을 입력해 주세요.";
  }
  const description = form.description.trim();
  if (description === "") errors.description = "설명을 입력해 주세요.";
  else if (description.length > SKILL_DESCRIPTION_MAX) {
    errors.description = `설명은 ${SKILL_DESCRIPTION_MAX}자까지 쓸 수 있습니다.`;
  }
  if (form.rules.trim() === "") errors.rules = "실행 규칙을 입력해 주세요.";
  else if (composeSkillInstructions(form).length > SKILL_INSTRUCTIONS_MAX) {
    errors.rules = `실행 규칙은 ${SKILL_INSTRUCTIONS_MAX.toLocaleString("ko-KR")}자까지 쓸 수 있습니다.`;
  }
  return errors;
}
