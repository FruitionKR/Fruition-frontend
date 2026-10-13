import type { DocumentPermission } from "@/entities/document/model/document";
import { ApiError } from "@/shared/lib/apiErrors";

type DocumentAccessFields = { can_edit?: boolean; can_delete?: boolean } | null | undefined;

/** 읽기 전용 안내 첫 줄(상태). 편집기 위 안내에서 두 줄로 나눠 보여준다. */
export const READ_ONLY_DOCUMENT_TITLE = "이 문서는 보기 권한만 있어 읽기 전용으로 열었습니다.";

/** 읽기 전용 안내 둘째 줄(편집 권한을 받는 방법). */
export const READ_ONLY_DOCUMENT_HINT = "편집하려면 문서 소유자나 워크스페이스 OWNER에게 편집 권한을 요청해 주세요.";

/** 읽기 전용 안내 전체. 저장 상태 자리의 배지 title처럼 한 문자열이 필요한 곳에 쓴다(줄바꿈으로 두 줄). */
export const READ_ONLY_DOCUMENT_MESSAGE = `${READ_ONLY_DOCUMENT_TITLE}\n${READ_ONLY_DOCUMENT_HINT}`;

/** 권한을 바꿀 수 없을 때(403 DOCUMENT_WRITE_FORBIDDEN) 보여줄 문구 */
export const PERMISSION_FORBIDDEN_MESSAGE =
  "권한을 바꿀 수 없습니다. 문서 권한은 문서 소유자와 워크스페이스 OWNER만, 폴더 권한은 OWNER만 바꿀 수 있습니다.";

/**
 * 서버가 can_edit=false를 내려준 문서만 읽기 전용이다.
 * 필드가 없는 구 서버 응답이나 아직 목록에서 못 찾은 문서는 편집 가능으로 본다(기본 권한이 "편집 가능").
 */
export function isDocumentReadOnly(document: DocumentAccessFields): boolean {
  return document?.can_edit === false;
}

/** 삭제·휴지통 복구는 문서 소유자와 OWNER만 한다. 필드가 없으면 서버가 403으로 막으므로 메뉴는 보여 준다. */
export function canDeleteDocument(document: DocumentAccessFields): boolean {
  return document?.can_delete !== false;
}

/** 권한 선택 UI에 보여줄 항목 */
export const PERMISSION_OPTIONS: { value: DocumentPermission | null; label: string; description: string }[] = [
  { value: null, label: "상위 설정 따름", description: "상위 폴더 설정이 없으면 워크스페이스 기본값(편집 가능)을 따릅니다." },
  { value: "edit", label: "편집 가능", description: "워크스페이스 멤버 누구나 본문을 고치고 이름을 바꿀 수 있습니다." },
  { value: "view", label: "보기만", description: "문서 소유자와 OWNER만 편집하고, 다른 멤버는 읽기 전용으로 봅니다." }
];

/** 편집 권한이 없어 서버가 쓰기를 거절한 응답(403 DOCUMENT_WRITE_FORBIDDEN)인지 */
export function isWriteForbiddenError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "DOCUMENT_WRITE_FORBIDDEN" || error.status === 403);
}

/** 권한 설정 요청이 실패했을 때 보여줄 문구. 403은 서버 원문 대신 누가 바꿀 수 있는지 설명한다. */
export function describePermissionError(error: unknown, fallback = "권한을 변경하지 못했습니다."): string {
  if (isWriteForbiddenError(error)) return PERMISSION_FORBIDDEN_MESSAGE;
  return error instanceof Error ? error.message : fallback;
}
