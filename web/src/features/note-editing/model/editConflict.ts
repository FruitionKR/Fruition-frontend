import { ApiError } from "@/shared/lib/apiErrors";

/** OWNER가 충돌을 해결할 때 고르는 본문. server는 그대로 두고, conflict는 충돌 본, merged는 보낸 markdown을 저장한다. */
export type ConflictChoice = "server" | "conflict" | "merged";

export type ConflictResolveRequest = {
  choice: ConflictChoice;
  base_revision?: number;
  markdown?: string;
};

/** 본문 저장 409 응답에서 메시지와 서버 현재 revision(error.current_revision)을 읽는다. */
export function parseVersionConflict(body: unknown): { message: string | null; currentRevision: number | null } {
  const error = (body as { error?: { message?: unknown; current_revision?: unknown } } | null)?.error;
  const currentRevision = typeof error?.current_revision === "number" && Number.isFinite(error.current_revision)
    ? error.current_revision
    : null;
  return { message: typeof error?.message === "string" ? error.message : null, currentRevision };
}

/**
 * 해결 요청 본문. conflict·merged는 목록의 server.revision을 base_revision으로 보내야 하고,
 * merged는 markdown도 필요하다. server는 본문을 그대로 두므로 둘 다 보내지 않는다.
 */
export function buildResolveRequest(choice: ConflictChoice, serverRevision: number, markdown?: string): ConflictResolveRequest {
  if (choice === "server") return { choice };
  if (choice === "merged") {
    if (typeof markdown !== "string") throw new Error("합친 본문(markdown)이 필요합니다.");
    return { choice, base_revision: serverRevision, markdown };
  }
  return { choice, base_revision: serverRevision };
}

export const CONFLICT_REGISTERED_MESSAGE =
  "다른 편집 내용이 먼저 저장되었습니다. 내 변경은 편집 충돌로 등록되어 워크스페이스 OWNER가 검토합니다. 이 화면의 편집은 더 저장되지 않으니 문서를 다시 열어 주세요.";
export const CONFLICT_REGISTRATION_FAILED_MESSAGE =
  "다른 편집 내용이 먼저 저장되었고, 내 변경을 편집 충돌로 등록하지도 못했습니다. 본문을 복사해 둔 뒤 문서를 다시 열어 주세요.";

/** 충돌 등록 결과에 따른 저장 상태 안내 문구 */
export function describeConflictRegistration(registered: boolean): string {
  return registered ? CONFLICT_REGISTERED_MESSAGE : CONFLICT_REGISTRATION_FAILED_MESSAGE;
}

/** 해결 요청 실패 문구. 서버 code별로 다음 행동을 안내한다. */
export function describeResolveError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "CONFLICT_ALREADY_RESOLVED") return "다른 OWNER가 이미 이 충돌을 해결했습니다. 목록을 새로 고쳐 주세요.";
    if (error.code === "DOCUMENT_VERSION_CONFLICT") return "그사이 문서가 또 바뀌어 반영하지 못했습니다. 목록을 새로 고친 뒤 다시 골라 주세요.";
    if (error.status === 423) return "다른 사용자가 이 문서를 편집 중이라 지금은 반영할 수 없습니다. 잠시 뒤 다시 시도해 주세요.";
    if (error.code === "EDIT_CONFLICT_NOT_FOUND" || error.status === 404) return "충돌을 찾을 수 없습니다. 이미 처리됐거나 문서가 삭제됐을 수 있습니다.";
  }
  return error instanceof Error ? error.message : "충돌을 해결하지 못했습니다.";
}
