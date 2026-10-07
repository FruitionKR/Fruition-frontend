import type { SkillAuthoringResult } from "@/entities/skill/model/skill";
import { ApiError, getErrorMessage, SessionExpiredError } from "@/shared/lib/errors";

export type SkillAuthorErrorNotice = { title: string; description: string };

const REJECTED_TITLE = "스킬 검토 요청이 거부되었습니다.";
const UNAVAILABLE_TITLE = "스킬 검토를 완료하지 못했습니다.";
const REJECTED_DESCRIPTION =
  "요청한 작업을 이해하지 못했거나 지원하지 않는 작업입니다. 무엇을 할지 구체적으로 적어 주세요.";
const UNAVAILABLE_DESCRIPTION = "AI 검토가 지금 응답하지 않습니다. 잠시 후 다시 시도해 주세요.";

/**
 * author 요청 실패를 사유별 안내로 바꾼다.
 * 백엔드는 AI의 400 사유를 SKILL_REQUEST_REJECTED 하나로 덮어 보내므로, 거절은 중립 문구로 안내한다.
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
