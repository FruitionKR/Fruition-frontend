import type { SkillAuthoringResult } from "@/entities/skill/model/skill";
import { ApiError, getErrorMessage, SessionExpiredError } from "@/shared/lib/errors";

export type SkillAuthorErrorNotice = { title: string; description: string };

const REJECTED_TITLE = "스킬 검토 요청이 거부되었습니다.";
const UNAVAILABLE_TITLE = "스킬 검토를 완료하지 못했습니다.";
const REJECTED_DESCRIPTION =
  "요청한 작업을 이해하지 못했거나 스킬로는 불가능한 작업입니다. 무엇을 할지 구체적으로 적어 주세요.";
const UNAVAILABLE_DESCRIPTION = "AI 검토가 지금 응답하지 않습니다. 잠시 후 다시 시도해 주세요.";
const UNSUPPORTED_DESCRIPTION = "스킬로는 불가능한 작업입니다. 문서 작성·수정·폴더 정리·템플릿 중 하나로 적어 주세요.";
const REFERENCE_TOO_LARGE_DESCRIPTION = "참고 문서는 한 개당 30,000자까지 쓸 수 있습니다. 더 짧은 문서를 골라 주세요.";
/** 서버 message가 화면용 한국어 안내인 거절 code. 빈 message는 parseApiError가 호출부 fallback으로 채운다. */
const SERVER_MESSAGE_CODES = new Set(["SKILL_INTENT_AMBIGUOUS", "SKILL_INSTRUCTION_INVALID"]);

/**
 * author 요청 실패를 사유별 안내로 바꾼다.
 * 사유 code(의도 불명확·지침 오류)가 오면 화면용 한국어인 서버 message를 그대로 보여 준다.
 * 불가능한 작업(SKILL_INTENT_UNSUPPORTED)은 서버 message 대신 정해 둔 문구로 안내한다.
 * 참고 문서 한 개가 너무 긴 경우(413 REFERENCE_DOCUMENT_TOO_LARGE)는 AI의 내부 용어가 섞인 message 대신 정해 둔 문구로 안내한다.
 * 사유 없는 거절(SKILL_REQUEST_REJECTED)과 알 수 없는 400은 중립 문구로 안내한다.
 * AI 서버 장애·5xx·타임아웃·네트워크 오류는 다시 시도하면 풀릴 수 있어 재시도 문구로 구분한다.
 */
export function describeSkillAuthorError(error: unknown): SkillAuthorErrorNotice {
  if (error instanceof SessionExpiredError) {
    return { title: UNAVAILABLE_TITLE, description: error.message };
  }
  if (!(error instanceof ApiError)) {
    // fetch 실패(TypeError)·중단(AbortError)처럼 응답을 받지 못한 경우다.
    return { title: UNAVAILABLE_TITLE, description: UNAVAILABLE_DESCRIPTION };
  }
  if (error.code === "SKILL_AI_UNAVAILABLE" || error.status >= 500 || error.status === 408) {
    return { title: UNAVAILABLE_TITLE, description: UNAVAILABLE_DESCRIPTION };
  }
  if (error.code === "REFERENCE_DOCUMENT_TOO_LARGE") {
    return { title: REJECTED_TITLE, description: REFERENCE_TOO_LARGE_DESCRIPTION };
  }
  if (error.code === "SKILL_INTENT_UNSUPPORTED") {
    return { title: REJECTED_TITLE, description: UNSUPPORTED_DESCRIPTION };
  }
  if (error.code != null && SERVER_MESSAGE_CODES.has(error.code)) {
    return { title: REJECTED_TITLE, description: error.message };
  }
  if (error.code === "SKILL_REQUEST_REJECTED" || error.status === 400) {
    return { title: REJECTED_TITLE, description: REJECTED_DESCRIPTION };
  }
  return { title: REJECTED_TITLE, description: getErrorMessage(error, "스킬 초안을 생성하지 못했습니다.") };
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
