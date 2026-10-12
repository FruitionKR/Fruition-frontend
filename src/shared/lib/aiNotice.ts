// 생성형 AI 사전 고지(AI 기본법 제31조①, 이슈 #131). 순수 함수만 두어 node:test로 검증한다.

/** 채팅 입력창 곁에 늘 보이는 짧은 고지 */
export const AI_NOTICE_MESSAGE = "생성형 AI가 답변합니다. 내용을 확인한 뒤 사용하세요.";
/** AI 기능 첫 사용 시 한 번 확인하는 안내 */
export const AI_FIRST_USE_NOTICE_MESSAGE =
  "이 서비스의 채팅·위키·문서 작성 기능은 생성형 AI로 운영됩니다. AI가 만든 내용은 사실과 다를 수 있으니 확인한 뒤 사용하세요.";
/** AI 생성물 라벨 문구(AI 기본법 제31조②, 화면 안 결과물은 UI 안내로 충분) */
export const AI_GENERATED_LABEL = "AI 생성";
export const AI_GENERATED_DESCRIPTION = "AI가 생성한 내용입니다. 내용을 확인한 뒤 사용하세요.";

export const AI_NOTICE_STORAGE_KEY = "fruition.ai-notice.v1";
const ACKNOWLEDGED_VALUE = "acknowledged";

/** localStorage와 같은 최소 인터페이스. 테스트에서는 Map 기반 가짜를 넘긴다. */
export type NoticeStorage = Pick<Storage, "getItem" | "setItem">;

/** 사전 고지를 확인했는지. 저장소를 못 읽으면(사생활 모드 등) 확인하지 않은 것으로 본다. */
export function hasAcknowledgedAiNotice(storage: NoticeStorage | null | undefined): boolean {
  try {
    return storage?.getItem(AI_NOTICE_STORAGE_KEY) === ACKNOWLEDGED_VALUE;
  } catch {
    return false;
  }
}

/** 확인을 기록한다. 저장이 실패해도 고지 자체는 이미 보였으므로 조용히 넘어가고 성공 여부만 돌려준다. */
export function acknowledgeAiNotice(storage: NoticeStorage | null | undefined): boolean {
  try {
    storage?.setItem(AI_NOTICE_STORAGE_KEY, ACKNOWLEDGED_VALUE);
    return Boolean(storage);
  } catch {
    return false;
  }
}
