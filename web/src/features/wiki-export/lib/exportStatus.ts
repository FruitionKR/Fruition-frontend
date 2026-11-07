import type koWiki from "@/shared/i18n/messages/ko/wiki.json";
import type { MessageTranslate } from "@/shared/i18n/messageTranslate";

export type ChatWikiExportStatus = "saved" | "skipped";

/**
 * 채팅 편입 완료 안내. 채팅 편입 문서의 위키 편입 안내는 이 알림 하나가 맡는다(일반 편입 제안에서는 빠진다).
 * canIngestNow면 알림에 '위키 편입' 버튼이 붙어 바로 편입을 시작할 수 있다.
 * t(`useTranslations("wiki.export")`)를 넘기면 지금 언어로 쓴다. 넘기지 않는 호출처를 위해 한국어 기본값을 둔다.
 */
export function getChatExportSuccessMessage(status: ChatWikiExportStatus, canIngestNow = false, t?: MessageTranslate<typeof koWiki.export>): string {
  if (status === "skipped") return t ? t("skipped") : "동일한 내용의 원문 문서가 있어 기존 문서를 열었습니다.";
  if (t) return t(canIngestNow ? "savedCanIngest" : "saved");
  return canIngestNow
    ? "채팅을 원문 문서로 저장했습니다. ‘위키 편입’을 누르면 채팅 답변 근거로 쓸 수 있게 위키에 편입합니다."
    : "채팅을 원문 문서로 저장했습니다. 위키에 편입하려면 ‘위키 편입’에서 문서를 선택해 주세요.";
}
