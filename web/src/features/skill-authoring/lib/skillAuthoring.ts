import type { SkillAuthoringResult, SkillExecutionOptions, SkillUpdateRequest } from "@/entities/skill/model/skill";
import { ApiError, getErrorMessage, INSUFFICIENT_CREDIT_MESSAGE, isInsufficientCreditError, SessionExpiredError } from "@/shared/lib/apiErrors";
import type { SharedTranslate } from "@/shared/i18n/sharedTranslate";
import type { SkillsTranslate } from "./skillsTranslate";

type SkillAuthorErrorNotice = { title: string; description: string };

/** 서버 message가 화면용 한국어 안내인 거절 code. 빈 message는 parseApiError가 호출부 fallback으로 채운다. */
const SERVER_MESSAGE_CODES = new Set(["SKILL_INTENT_AMBIGUOUS", "SKILL_INSTRUCTION_INVALID", "SKILL_TARGETS_INVALID"]);

/**
 * author 요청 실패를 사유별 안내로 바꾼다.
 * 사유 code(의도 불명확·지침 오류·대상 오류)가 오면 화면용 한국어인 서버 message를 그대로 보여 준다.
 * 불가능한 작업(SKILL_INTENT_UNSUPPORTED)은 서버 message 대신 정해 둔 문구로 안내한다.
 * 참고 문서 한 개가 너무 긴 경우(413 REFERENCE_DOCUMENT_TOO_LARGE)는 AI의 내부 용어가 섞인 message 대신 정해 둔 문구로 안내한다.
 * 크레딧 부족(402 INSUFFICIENT_CREDIT)은 공통 문의 안내로 보여 준다(#153).
 * 사유 없는 거절(SKILL_REQUEST_REJECTED)과 알 수 없는 400은 중립 문구로 안내한다.
 * AI 서버 장애·5xx·타임아웃·네트워크 오류는 다시 시도하면 풀릴 수 있어 재시도 문구로 구분한다.
 * 공용 문구(크레딧·권한·연결 오류)는 ts(shared)로 지금 언어에 맞춘다.
 */
export function describeSkillAuthorError(error: unknown, t: SkillsTranslate, ts?: SharedTranslate): SkillAuthorErrorNotice {
  const rejectedTitle = t("authorError.rejectedTitle");
  const unavailableTitle = t("authorError.unavailableTitle");
  if (error instanceof SessionExpiredError) {
    return { title: unavailableTitle, description: error.message };
  }
  if (!(error instanceof ApiError)) {
    // fetch 실패(TypeError)·중단(AbortError)처럼 응답을 받지 못한 경우다.
    return { title: unavailableTitle, description: t("authorError.unavailable") };
  }
  if (isInsufficientCreditError(error)) {
    return { title: unavailableTitle, description: ts ? ts("errors.insufficientCredit") : INSUFFICIENT_CREDIT_MESSAGE };
  }
  if (error.code === "SKILL_AI_UNAVAILABLE" || error.status >= 500 || error.status === 408) {
    return { title: unavailableTitle, description: t("authorError.unavailable") };
  }
  if (error.code === "REFERENCE_DOCUMENT_TOO_LARGE") {
    return { title: rejectedTitle, description: t("authorError.referenceTooLarge") };
  }
  if (error.code === "SKILL_INTENT_UNSUPPORTED") {
    return { title: rejectedTitle, description: t("authorError.unsupported") };
  }
  if (error.code != null && SERVER_MESSAGE_CODES.has(error.code)) {
    return { title: rejectedTitle, description: error.message };
  }
  if (error.code === "SKILL_REQUEST_REJECTED" || error.status === 400) {
    return { title: rejectedTitle, description: t("authorError.rejected") };
  }
  return { title: rejectedTitle, description: getErrorMessage(error, t("authorError.fallback"), ts) };
}

/**
 * author 응답을 다음 화면으로 분기한다.
 * - clarify: AI가 지침을 더 구체적으로 적어 달라고 되물었다(question). 초안이 없어 STEP 3으로 갈 수 없다.
 * - review: 위험 표현이 발견됐다(blocked 또는 issues). STEP 2에서 고친다.
 * - pass: 통과. STEP 3으로 간다.
 */
export function skillAuthoringOutcome(result: Pick<SkillAuthoringResult, "status" | "issues">): "clarify" | "review" | "pass" {
  if (result.status === "clarification_required") return "clarify";
  if (result.status === "blocked" || (result.issues ?? []).length > 0) return "review";
  return "pass";
}

/**
 * 'AI로 작성·보강' 초안을 확인 없이 게시할지. 안전 검토를 통과했고 입력이 온전할 때만 게시한다.
 * 기존 커맨드와 겹치는지 아직 모르면(스킬 목록을 못 받음) 사람이 확인한다.
 * 요청한 뒤 입력을 고쳤거나 시트를 닫았으면 그 초안은 게시하지 않는다.
 * 'AI로 안전하게 다시 만들기'도 검토를 통과하면 바로 게시한다. 자동 승인을 켠 사용자가 허용한 범위로 본다.
 */
export function shouldAutoPublishSkillDraft(input: {
  isEnabled: boolean;
  outcome: ReturnType<typeof skillAuthoringOutcome>;
  validationErrorCount: number;
  isSkillListLoaded: boolean;
  isFormUnchanged: boolean;
  isEditorOpen: boolean;
}): boolean {
  return input.isEnabled && input.outcome === "pass" && input.validationErrorCount === 0 && input.isSkillListLoaded
    && input.isFormUnchanged && input.isEditorOpen;
}

/**
 * 스킬 수정 요청을 만든다. name은 상세 시트의 커맨드명이다(PATCH가 name으로 slug를 바꾼다).
 * capabilities(종류·결과 방식을 바꿨을 때)·대상·결과 방식·원문 문서는 초안에 있을 때만 보낸다.
 * 빼면 서버가 기존 값을 유지하거나 정한다.
 */
export function skillUpdateRequest(
  draft: { name: string; description: string; instructionsMarkdown: string; capabilities?: readonly string[] } & SkillExecutionOptions
): SkillUpdateRequest {
  return {
    name: draft.name,
    description: draft.description,
    instructions_markdown: draft.instructionsMarkdown,
    ...(draft.capabilities != null ? { capabilities: [...draft.capabilities] } : {}),
    ...(draft.targets != null ? { targets: [...draft.targets] } : {}),
    ...(draft.result_mode != null ? { result_mode: draft.result_mode } : {}),
    ...(draft.requires_source != null ? { requires_source: draft.requires_source } : {})
  };
}

/**
 * 시트를 연 뒤 입력을 고쳤는지. 저장(스킬 만들기) 전에는 반영하지 않으므로, 고친 채 닫으면 버릴지 묻는다.
 * 폼은 문자열·배열·null로만 이루어져 값 비교로 충분하다.
 */
export function isSkillFormDirty(initial: object, current: object): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}

/**
 * 결과 방식이 capabilities와 맞지 않을 때의 code. document는 AI의 invalid_result_mode를 400 SKILL_RESULT_MODE_INVALID로 옮긴다.
 * 그 밖의 표기(AI 원래 code·대문자)도 같은 뜻으로 받는다.
 */
const RESULT_MODE_REJECTION_CODES = new Set([
  "SKILL_RESULT_MODE_INVALID",
  "invalid_result_mode",
  "INVALID_RESULT_MODE",
  "SKILL_INVALID_RESULT_MODE"
]);
/** 허용되지 않는 capabilities 값·조합(게시와 같은 검증). document 매핑이 없던 때의 AI 원래 표기도 받는다. */
const CAPABILITIES_REJECTION_CODES = new Set(["SKILL_CAPABILITIES_INVALID", "invalid_capabilities", "INVALID_CAPABILITIES"]);

/**
 * 스킬 수정(PATCH) 실패 문구.
 * - 대상이 맞지 않으면(400 SKILL_TARGETS_INVALID, AI invalid_targets) 대상 문제임을 알리는 서버의 한국어 message를,
 *   비었으면 정해 둔 문구를 보여 준다.
 * - 결과 방식 불일치(SKILL_RESULT_MODE_INVALID 등)·허용되지 않는 종류(SKILL_CAPABILITIES_INVALID)는 서버 message가
 *   AI 내부 표현일 수 있어 정해 둔 문구로 종류·결과 방식을 다시 고르게 한다.
 * 그 밖에는 서버 message나 정해 둔 실패 문구다. 문구는 t(skills 네임스페이스)로 현재 언어에 맞춘다.
 */
export function describeSkillSaveError(error: unknown, t: SkillsTranslate, ts?: SharedTranslate): string {
  const fallback = t("saveError.fallback");
  if (error instanceof ApiError && error.code != null) {
    if (error.code === "SKILL_TARGETS_INVALID") {
      const message = error.message.trim();
      return message && message !== fallback ? message : t("saveError.targetsInvalid");
    }
    if (RESULT_MODE_REJECTION_CODES.has(error.code)) return t("saveError.resultModeInvalid");
    if (CAPABILITIES_REJECTION_CODES.has(error.code)) return t("saveError.capabilitiesInvalid");
  }
  return getErrorMessage(error, fallback, ts);
}
