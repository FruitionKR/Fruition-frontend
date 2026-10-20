// Skill API 계약 타입 (docs/api/document/skills.md)

/** 실행 대상 (ai#122). 문서 Skill에만 저장된다. */
export type SkillTargetValue = "current_document" | "selection";
/** 결과 방식 (ai#122). create=새 문서, edit=현재 문서 수정, auto=상황에 맞게 */
export type SkillResultModeValue = "create" | "edit" | "auto";

export interface SkillVersion {
  id: string;
  name: string;
  description: string;
  status: string;
  version: number;
  allowed_tools: string[];
  capabilities: string[];
  instructions_markdown: string;
  /** ai#122 배포 전 응답에는 없다. 그 전에 게시된 문서 Skill은 두 대상을 모두 담아 내려온다. */
  targets?: SkillTargetValue[];
  result_mode?: SkillResultModeValue | null;
  /**
   * 원문 문서가 필요한지. true면 폴더에 실행할 때 폴더 안 Markdown 문서를 원문으로 읽고, false면 원문 없이 새 문서를 만든다.
   * 보낸 값 → 지침에 {문서} → true, 템플릿 → false 순으로 정하고, LLM 분류는 작성 초안·지침을 바꾼 수정에서만 한다(게시는 다시 분류하지 않음).
   * 예전 Skill은 AI가 조회할 때 계산해 준다. 이 필드가 없는 백엔드는 undefined다.
   */
  requires_source?: boolean | null;
}

// POST /skills/author 요청 (SkillAuthoringRequest)
export interface SkillAuthoringRequest {
  instruction: string;
  authoring_mode?: string;
  name?: string;
  description?: string;
  scope_type?: string;
  reference_document_ids?: string[];
}

// author / publish / PATCH 공통 응답 (초안·게시 결과)
export interface SkillAuthoringResult {
  skill_id: string;
  version_id: string;
  name: string;
  description: string;
  instructions_markdown: string;
  skill_markdown: string;
  scope_type: string;
  status: string;
  allowed_tools: string[];
  capabilities: string[];
  targets?: SkillTargetValue[];
  result_mode?: SkillResultModeValue | null;
  /** 작성 초안에서는 의도 분류 판단이다. 게시는 다시 분류하지 않으므로 이 값을 게시 요청에 실어야 유지된다. */
  requires_source?: boolean | null;
  issues: unknown[];
  question: string | null;
}

/** 실행 대상·결과 방식. 문서 Skill만 보내고, 폴더 정리·템플릿 Skill은 키를 빼야 한다(ai invalid_targets/invalid_result_mode). */
export interface SkillExecutionOptions {
  targets?: SkillTargetValue[];
  result_mode?: SkillResultModeValue;
  /** 게시: 초안 판단이나 사용자 선택이 있으면 보낸다(생략하면 {문서}·템플릿 규칙만). 수정: 바꿨을 때만 보낸다. */
  requires_source?: boolean;
}

// POST /skills/author/publish 요청 (SkillPublishRequest).
// allowed_tools는 보내지 않는다. 서버가 capabilities로 계산한다(ai#121).
export interface SkillPublishRequest extends SkillExecutionOptions {
  name: string;
  description: string;
  instructions_markdown: string;
  scope_type: string;
  capabilities: string[];
}

// PATCH /skills/{id} 요청. 백엔드가 이름·설명·지침을 필수로 검증한다.
// targets·result_mode는 생략하면 기존 값을 유지하고, targets: []는 기본값으로 되돌린다.
// capabilities는 종류·결과 방식을 바꿀 때만 보낸다(게시와 같은 규칙). 생략하면 이전 버전 값을 이어받는다.
export interface SkillUpdateRequest extends SkillExecutionOptions {
  name: string;
  description: string;
  instructions_markdown: string;
  capabilities?: string[];
}

// POST /skills/test-run 요청 (SkillTestRunRequest). 아무것도 저장하지 않는다.
// 적용 범위(target)는 보내지 않는다. 생략하면 서버가 문서 전체에 적용한다.
export interface SkillTestRunRequest {
  name: string;
  description: string;
  instructions_markdown: string;
  capabilities: string[];
  document_id: string;
  markdown?: string;
}

export interface SkillTestRunChange {
  section: string;
  start_line: number;
  end_line: number;
  before: string;
  after: string;
}

// POST /skills/test-run 응답. blocked면 실행하지 않고 issues만 준다.
export interface SkillTestRunResponse {
  run_id: string;
  status: "completed" | "blocked";
  changes: SkillTestRunChange[];
  untouched_sections: string[];
  result_markdown: string | null;
  issues: unknown[];
}

export interface SkillResponse {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  slug: string;
  scope_type: string; // "personal" | 워크스페이스 공용
  status: string;
  enabled_version: SkillVersion | null;
  latest_version: SkillVersion | null;
}
