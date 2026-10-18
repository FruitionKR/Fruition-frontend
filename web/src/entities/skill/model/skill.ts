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
  issues: unknown[];
  question: string | null;
}

/** 실행 대상·결과 방식. 문서 Skill만 보내고, 폴더 정리·템플릿 Skill은 키를 빼야 한다(ai invalid_targets/invalid_result_mode). */
export interface SkillExecutionOptions {
  targets?: SkillTargetValue[];
  result_mode?: SkillResultModeValue;
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
export interface SkillUpdateRequest extends SkillExecutionOptions {
  name: string;
  description: string;
  instructions_markdown: string;
}

/** 테스트 실행 적용 범위. 1-based 줄 번호(끝 포함). 생략하면 문서 전체다. */
export interface SkillTestRunTarget {
  type: "selection" | "current_section" | "whole_document";
  start_line: number;
  end_line: number;
}

// POST /skills/test-run 요청 (SkillTestRunRequest). 아무것도 저장하지 않는다.
export interface SkillTestRunRequest {
  name: string;
  description: string;
  instructions_markdown: string;
  capabilities: string[];
  document_id: string;
  markdown?: string;
  target?: SkillTestRunTarget;
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
