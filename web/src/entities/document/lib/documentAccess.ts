import type { DocumentPermission } from "@/entities/document/model/document";
import { ApiError } from "@/shared/lib/apiErrors";
import type koDocuments from "@/shared/i18n/messages/ko/documents.json";
import type { MessageTranslate } from "@/shared/i18n/messageTranslate";

type DocumentAccessFields = { can_edit?: boolean; can_delete?: boolean; can_convert?: boolean; ai_origin?: string | null } | null | undefined;

/** 읽기 전용 안내 첫 줄(상태). 편집기 위 안내에서 두 줄로 나눠 보여준다. */
export const READ_ONLY_DOCUMENT_TITLE = "이 문서는 보기 권한만 있어 읽기 전용으로 열었습니다.";

/** 읽기 전용 안내 둘째 줄(편집 권한을 받는 방법). */
export const READ_ONLY_DOCUMENT_HINT = "편집하려면 문서 소유자나 워크스페이스 OWNER에게 편집 권한을 요청해 주세요.";

/** 읽기 전용 안내 전체. 저장 상태 자리의 배지 title처럼 한 문자열이 필요한 곳에 쓴다(줄바꿈으로 두 줄). */
export const READ_ONLY_DOCUMENT_MESSAGE = `${READ_ONLY_DOCUMENT_TITLE}\n${READ_ONLY_DOCUMENT_HINT}`;

/**
 * 서버가 can_edit=false를 내려준 문서만 읽기 전용이다.
 * 필드가 없는 구 서버 응답이나 아직 목록에서 못 찾은 문서는 편집 가능으로 본다(기본 권한이 "편집 가능").
 */
export function isDocumentReadOnly(document: DocumentAccessFields): boolean {
  return document?.can_edit === false;
}

/** 채팅 Wiki page화 문서의 제목 칸 안내·이름 변경 거절(409 DOCUMENT_TITLE_LOCKED) 문구. */
export const CHAT_EXPORT_TITLE_LOCKED_MESSAGE = "채팅에서 만든 문서는 이름과 본문을 바꿀 수 없습니다.";

/** 서버가 채팅에서 만든 문서의 이름 변경을 거절할 때 보내는 error.code. */
export const DOCUMENT_TITLE_LOCKED_CODE = "DOCUMENT_TITLE_LOCKED";

/**
 * 권한과 무관하게 본문과 이름을 고칠 수 없는 문서인지. 채팅 Wiki page화 문서(ai_origin=chat_export)는
 * 서버가 편집 잠금·저장을 400, 이름 변경을 409(DOCUMENT_TITLE_LOCKED)로 거절하므로 편집기·이름 변경을 열지 않는다.
 * 이동·삭제는 권한(can_edit·can_delete)을 따른다.
 */
export function isDocumentBodyLocked(document: DocumentAccessFields): boolean {
  return document?.ai_origin === "chat_export";
}

/** 삭제·휴지통 복구는 문서 소유자와 OWNER만 한다. 필드가 없으면 서버가 403으로 막으므로 메뉴는 보여 준다. */
export function canDeleteDocument(document: DocumentAccessFields): boolean {
  return document?.can_delete !== false;
}

/** Markdown 변환을 막을 때(can_convert=false) 메뉴·편입 선택·알림에 함께 보여줄 이유 */
export const CONVERT_FORBIDDEN_REASON = "이 PDF를 변환할 권한이 없어요. 다른 사람이 올린 PDF는 변환 권한이, 보기 폴더 안 PDF는 폴더 편집 권한이 있어야 해요";

/**
 * PDF → Markdown 변환은 올린 사람, document.convert 권한이 있는 멤버, OWNER만 한다(can_convert).
 * 필드가 없는 구 서버 응답은 지금처럼 요청을 보내고 서버 판정에 맡긴다.
 */
export function canConvertDocument(document: DocumentAccessFields): boolean {
  return document?.can_convert !== false;
}

/** 권한 선택 UI의 항목 순서. null은 상위 설정 따름이다. 문구는 documents.permission.options 메시지에 있다. */
export const PERMISSION_OPTION_VALUES: readonly (DocumentPermission | null)[] = [null, "edit", "view"];

/** 트리 행에 붙이는 자체 권한 표시 문구. 자기 설정이 없으면(null·필드 없음) 표시하지 않는다. */
export function permissionIndicatorLabel(permission: DocumentPermission | null | undefined): string | null {
  if (permission === "view") return "보기만 가능";
  if (permission === "edit") return "편집 가능";
  return null;
}

/**
 * 권한 저장 성공 알림 본문. 이름 뒤 조사 문제를 피하려고 "'이름' 권한을 …으로" 형태로 쓴다.
 * t(`useTranslations("documents.permission")`)를 넘기면 지금 언어로 쓴다.
 */
export function permissionChangedMessage(label: string, access: DocumentPermission | null, t?: MessageTranslate<typeof koDocuments.permission>): string {
  if (t) return t("changed", { label, access: access ?? "inherit" });
  const phrase = permissionIndicatorLabel(access) ?? "상위 설정 따름";
  return `'${label}' 권한을 ${phrase}으로 바꿨습니다.`;
}

/** 편집 권한이 없어 서버가 쓰기를 거절한 응답(403 DOCUMENT_WRITE_FORBIDDEN)인지 */
export function isWriteForbiddenError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "DOCUMENT_WRITE_FORBIDDEN" || error.status === 403);
}

/** 위 문구 중 다른 모듈이 이유·오류 값으로 넘겨 화면에 닿는 것의 메시지 키(documents.access.*). 다른 문구면 null이다. */
export function documentAccessMessageKey(message: string): "convertForbidden" | "chatExportTitleLocked" | null {
  if (message === CONVERT_FORBIDDEN_REASON) return "convertForbidden";
  if (message === CHAT_EXPORT_TITLE_LOCKED_MESSAGE) return "chatExportTitleLocked";
  return null;
}
