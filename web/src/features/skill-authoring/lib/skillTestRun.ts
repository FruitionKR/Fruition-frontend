import type { SkillTestRunRequest, SkillTestRunResponse } from "@/entities/skill/model/skill";
import { lineDiff, type MarkdownDiffLine } from "@/shared/lib/lineDiff";
import { ApiError, INSUFFICIENT_CREDIT_MESSAGE, isInsufficientCreditError, SessionExpiredError } from "@/shared/lib/apiErrors";
import type { SharedTranslate } from "@/shared/i18n/sharedTranslate";
import type { SkillsTranslate } from "./skillsTranslate";
import { skillCapabilities, skillRequiresSourceOption, validateSkillCreateForm, type SkillCreateForm } from "./skillCreateForm";

/**
 * 스킬 만들기 시트의 "테스트 실행" 카드(Figma 1671:14585). 게시 전 정의를 문서 하나에 적용해 보고 아무것도 저장하지 않는다.
 * POST /skills/test-run 요청을 만들고, 응답·오류를 화면 문구로 바꾼다. 적용 범위는 고르지 않고 항상 문서 전체다.
 */

/** 폴더 정리 스킬은 테스트 실행을 지원하지 않는다(서버도 SKILL_TEST_RUN_UNSUPPORTED). 카드는 문서 선택 대신 안내(testRun.folderNote)만 둔다. */
export function supportsSkillTestRun(kind: SkillCreateForm["kind"]): boolean {
  return kind !== "folder";
}

/** run_id는 한 번만 쓸 수 있어(재사용하면 409) 실행마다 새로 만든다. 서버 형식: [a-zA-Z0-9:_-]{1,120} */
export function newSkillTestRunId(): string {
  return `skill_test_${crypto.randomUUID()}`;
}

/** 테스트를 시작할 수 없는 이유. skills 메시지 testRun.blocker 아래 키다. */
export type SkillTestRunBlocker = "folder" | "fields" | "document";

/**
 * 테스트를 시작할 수 없는 이유. 시작할 수 있으면 null.
 * 서버가 게시와 같은 이름·설명·지침 검증을 하므로 같은 필드가 채워져야 한다(커맨드 중복은 게시 때만 막는다).
 */
export function skillTestRunBlocker(form: SkillCreateForm, documentId: string): SkillTestRunBlocker | null {
  if (form.kind === "folder") return "folder";
  const errors = validateSkillCreateForm(form, []);
  if (errors.command != null || errors.description != null || errors.rules != null) {
    return "fields";
  }
  if (documentId === "") return "document";
  return null;
}

/**
 * 시트 입력값 + 테스트 문서 → POST /skills/test-run 요청. Tool 허용 목록은 서버가 capabilities로 계산한다.
 * target을 보내지 않아 서버가 문서 전체에 적용한다.
 * requires_source는 게시(skillPublishRequest)와 같은 조건·값으로 실어 테스트 결과가 게시 후 실행과 같게 한다.
 */
export function skillTestRunRequest(form: SkillCreateForm, documentId: string): SkillTestRunRequest {
  return {
    name: form.command.trim(),
    description: form.description.trim(),
    instructions_markdown: form.rules.trim(),
    capabilities: skillCapabilities(form.kind, form.resultMode),
    document_id: documentId,
    ...skillRequiresSourceOption(form)
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

/** 테스트 실행 실패 → 카드 안내 문구. 서버가 준 문구는 그대로 쓴다. 크레딧 안내는 ts(shared)로 지금 언어에 맞춘다. */
export function describeSkillTestRunError(error: unknown, t: SkillsTranslate, ts?: SharedTranslate): string {
  if (error instanceof SessionExpiredError) return error.message;
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return t("testRun.error.timeout");
  }
  if (!(error instanceof ApiError)) return t("testRun.error.unavailable");
  if (isInsufficientCreditError(error)) return t("testRun.error.insufficientCredit", { message: ts ? ts("errors.insufficientCredit") : INSUFFICIENT_CREDIT_MESSAGE });
  if (error.code === "SKILL_TEST_RUN_UNAVAILABLE") return t("testRun.error.notReady");
  if (error.code === "SKILL_TEST_RUN_UNSUPPORTED") return t("testRun.error.unsupported");
  if (error.status === 408 || error.status >= 500) return t("testRun.error.unavailable");
  if (error.status === 404) return t("testRun.error.notFound");
  if (error.status === 409) return t("testRun.error.conflict");
  if (error.status === 413) return t("testRun.error.tooLarge");
  if (error.code === "INVALID_REQUEST") return t("testRun.error.markdownOnly");
  if (error.code === "SKILL_REQUEST_REJECTED") return t("testRun.error.rejected");
  return error.message || t("testRun.error.fallback");
}
