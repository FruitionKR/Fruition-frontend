import type { SkillTestRunRequest, SkillTestRunResponse } from "@/entities/skill/model/skill";
import { lineDiff, type MarkdownDiffLine } from "@/shared/lib/lineDiff";
import { ApiError, INSUFFICIENT_CREDIT_MESSAGE, isInsufficientCreditError, SessionExpiredError } from "@/shared/lib/apiErrors";
import {
  skillCapabilities,
  validateSkillCreateForm,
  type SkillCreateForm,
  type SkillTarget
} from "./skillCreateForm";

/**
 * 스킬 만들기 시트의 "테스트 실행" 카드(Figma 1671:14585). 게시 전 정의를 문서 하나에 적용해 보고 아무것도 저장하지 않는다.
 * POST /skills/test-run 요청을 만들고, 응답·오류를 화면 문구로 바꾼다.
 */

/** 적용 범위: 문서 전체(target 생략) 또는 줄 범위(selection) */
export type SkillTestRunScope = "whole" | "lines";

export const SKILL_TEST_RUN_SCOPE_OPTIONS: ReadonlyArray<{ value: SkillTestRunScope; label: string }> = [
  { value: "whole", label: "문서 전체" },
  { value: "lines", label: "줄 범위 지정" }
];

export interface SkillTestRunInput {
  documentId: string;
  scope: SkillTestRunScope;
  startLine: number;
  endLine: number;
}

/** 폴더 정리 스킬은 테스트 실행을 지원하지 않는다(서버도 SKILL_TEST_RUN_UNSUPPORTED). 카드는 문서 선택 대신 안내만 둔다. */
export const SKILL_TEST_RUN_FOLDER_NOTE = "폴더 정리 스킬은 테스트 실행을 지원하지 않아요. 저장한 뒤 작업 탭에서 실행하면 승인 전에 정리 계획을 확인할 수 있어요.";

export function supportsSkillTestRun(kind: SkillCreateForm["kind"]): boolean {
  return kind !== "folder";
}

/** 대상이 "선택한 부분"뿐인 스킬은 선택 범위가 있어야 동작하므로 줄 범위로 시작한다. */
export function defaultSkillTestRunScope(targets: readonly SkillTarget[]): SkillTestRunScope {
  return targets.length === 1 && targets[0] === "selection" ? "lines" : "whole";
}

/** run_id는 한 번만 쓸 수 있어(재사용하면 409) 실행마다 새로 만든다. 서버 형식: [a-zA-Z0-9:_-]{1,120} */
export function newSkillTestRunId(): string {
  return `skill_test_${crypto.randomUUID()}`;
}

/** 줄 범위 입력 오류 문구. 문제가 없으면 null. 문서 줄 수를 넘는지는 서버가 검사한다. */
export function skillTestRunRangeError(input: Pick<SkillTestRunInput, "scope" | "startLine" | "endLine">): string | null {
  if (input.scope !== "lines") return null;
  const { startLine, endLine } = input;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < 1) {
    return "줄 번호는 1 이상의 정수로 입력해 주세요.";
  }
  if (endLine < startLine) return "끝 줄은 시작 줄보다 앞설 수 없어요.";
  return null;
}

/**
 * 테스트를 시작할 수 없는 이유. 시작할 수 있으면 null.
 * 서버가 게시와 같은 이름·설명·지침 검증을 하므로 같은 필드가 채워져야 한다(커맨드 중복은 게시 때만 막는다).
 */
export function skillTestRunBlocker(form: SkillCreateForm, input: SkillTestRunInput): string | null {
  if (form.kind === "folder") return "폴더 정리 스킬은 테스트 실행을 지원하지 않아요.";
  const errors = validateSkillCreateForm(form, []);
  if (errors.command != null || errors.description != null || errors.rules != null) {
    return "커맨드명·설명·실행 규칙을 먼저 올바르게 입력해 주세요.";
  }
  if (input.documentId === "") return "테스트할 문서를 골라 주세요.";
  return skillTestRunRangeError(input);
}

/** 시트 입력값 + 테스트 문서·범위 → POST /skills/test-run 요청. Tool 허용 목록은 서버가 capabilities로 계산한다. */
export function skillTestRunRequest(form: SkillCreateForm, input: SkillTestRunInput): SkillTestRunRequest {
  return {
    name: form.command.trim(),
    description: form.description.trim(),
    instructions_markdown: form.rules.trim(),
    capabilities: skillCapabilities(form.kind, form.resultMode),
    document_id: input.documentId,
    ...(input.scope === "lines"
      ? { target: { type: "selection" as const, start_line: input.startLine, end_line: input.endLine } }
      : {})
  };
}

export type SkillTestRunView =
  | { kind: "blocked"; issues: unknown[] }
  | { kind: "changes"; changes: SkillTestRunResponse["changes"]; untouchedSections: string[] }
  | { kind: "created"; markdown: string }
  | { kind: "unchanged"; untouchedSections: string[] };

/**
 * 응답 → 카드에 그릴 결과.
 * - blocked: 안전 검토에서 막혀 실행하지 않았다.
 * - changes: 섹션별 변경 전/후(문서 수정형).
 * - created: 문서 생성형(document-edit 없는 document-create·template)은 changes 없이 만들어질 문서만 준다.
 * - unchanged: 바뀐 곳이 없다(편집형은 이때도 result_markdown에 원문 전체가 온다).
 */
export function skillTestRunView(result: SkillTestRunResponse, capabilities: readonly string[]): SkillTestRunView {
  if (result.status === "blocked") return { kind: "blocked", issues: result.issues ?? [] };
  const changes = result.changes ?? [];
  const untouchedSections = result.untouched_sections ?? [];
  if (changes.length > 0) return { kind: "changes", changes, untouchedSections };
  const markdown = result.result_markdown ?? "";
  if (!capabilities.includes("document-edit") && markdown.trim() !== "") return { kind: "created", markdown };
  return { kind: "unchanged", untouchedSections };
}

/** 섹션 변경 전/후를 줄 단위로 비교한다. 바뀐 줄만 지움·추가로, 그대로인 줄은 맥락(context)으로 둔다. */
export function skillChangeDiffLines(change: { before: string; after: string }): MarkdownDiffLine[] {
  if (change.before === "") return change.after === "" ? [] : change.after.split("\n").map((text) => ({ type: "insert", text }));
  if (change.after === "") return change.before.split("\n").map((text) => ({ type: "delete", text }));
  return lineDiff(change.before, change.after);
}

const UNAVAILABLE_MESSAGE = "AI가 지금 응답하지 않습니다. 잠시 후 다시 테스트해 주세요.";

/** 테스트 실행 실패 → 카드 안내 문구 */
export function describeSkillTestRunError(error: unknown): string {
  if (error instanceof SessionExpiredError) return error.message;
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "테스트 응답이 너무 오래 걸려 중단했어요. 줄 범위를 줄이거나 잠시 후 다시 테스트해 주세요.";
  }
  if (!(error instanceof ApiError)) return UNAVAILABLE_MESSAGE;
  if (isInsufficientCreditError(error)) return `${INSUFFICIENT_CREDIT_MESSAGE} 크레딧을 충전한 뒤 다시 테스트해 주세요.`;
  if (error.code === "SKILL_TEST_RUN_UNAVAILABLE") {
    return "테스트 실행을 아직 사용할 수 없어요. 서버 업데이트 후 다시 시도해 주세요.";
  }
  if (error.code === "SKILL_TEST_RUN_UNSUPPORTED") {
    return "이 종류의 스킬은 테스트 실행을 지원하지 않아요. 문서 작성·수정·템플릿 스킬만 테스트할 수 있어요.";
  }
  if (error.status === 408 || error.status >= 500) return UNAVAILABLE_MESSAGE;
  if (error.status === 404) return "테스트할 문서를 찾을 수 없어요. 다른 문서를 골라 주세요.";
  if (error.status === 409) return "이미 처리된 테스트 요청이에요. 다시 테스트해 주세요.";
  if (error.status === 413) return "문서가 너무 커서(5MB 초과) 테스트할 수 없어요.";
  if (error.code === "INVALID_REQUEST") {
    return "Markdown 문서만, 문서 줄 수 안의 범위로 테스트할 수 있어요. 문서와 줄 범위를 확인해 주세요.";
  }
  if (error.code === "SKILL_REQUEST_REJECTED") return "AI가 이 스킬로 테스트를 진행하지 않았어요. 실행 규칙을 구체적으로 고쳐 주세요.";
  return error.message || "스킬을 테스트하지 못했습니다.";
}
