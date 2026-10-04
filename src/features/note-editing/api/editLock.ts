import { apiFetch, ERROR_MESSAGES, getWorkspaceId, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import { describeEditLockHolder } from "../model/editLockSchedule";

/** 편집 잠금 상태. 잠금이 없으면 필드 자체가 빠진다. */
export type EditLockResponse = {
  /** 잠금 만료 시각(ISO-8601 UTC). 이 시각이 지나면 다른 사용자가 잠글 수 있다. */
  expires_at?: string;
  holder_display_name?: string;
  holder_user_id?: string;
};

/** 다른 사용자가 편집 중이라 잠금을 받지 못했다(423). 보유자 정보를 함께 전달한다. */
export class EditLockHeldError extends Error {
  readonly lock: EditLockResponse;

  constructor(lock: EditLockResponse) {
    super(describeEditLockHolder(lock));
    this.lock = lock;
  }
}

/** 편집 중에 잠금을 잃었다(heartbeat 409: 만료 또는 타인 보유). */
export class EditLockLostError extends Error {}

function editLockPath(documentId: string): string {
  return `${workspacePath(getWorkspaceId(), "documents", documentId)}/edit-lock`;
}

/**
 * 편집기 진입 시 잠금을 획득한다. 비었거나 만료됐거나 본인 보유면 잠금을 받는다.
 * 서버 상세는 노출하지 않고 정해진 안내 문구만 던진다.
 */
export async function acquireEditLock(documentId: string): Promise<EditLockResponse> {
  const response = await apiFetch(editLockPath(documentId), { method: "POST", cache: "no-store" });
  if (response.status === 423) {
    throw new EditLockHeldError(await response.json().catch(() => ({})) as EditLockResponse);
  }
  if (response.status === 403) throw new Error(ERROR_MESSAGES.editLockForbidden);
  if (response.status === 404) throw new Error(ERROR_MESSAGES.editLockMissing);
  return parseJsonOrThrow<EditLockResponse>(response, ERROR_MESSAGES.editLockFailed);
}

/** 편집 중 주기적으로 호출해 잠금을 연장한다. 보유자가 아니거나 만료됐으면 409. */
export async function sendEditLockHeartbeat(documentId: string): Promise<EditLockResponse> {
  const response = await apiFetch(`${editLockPath(documentId)}/heartbeat`, { method: "POST", cache: "no-store" });
  if (response.status === 409) throw new EditLockLostError(ERROR_MESSAGES.editLockLost);
  return parseJsonOrThrow<EditLockResponse>(response, ERROR_MESSAGES.editLockFailed);
}

/** 편집기 종료 시 호출한다. 보유자 본인의 잠금만 해제하며 멱등이다. */
export async function releaseEditLock(documentId: string): Promise<void> {
  // 해제 실패는 사용자가 할 수 있는 일이 없고, 서버의 expires_at 만료가 최종 안전장치라 상태를 따지지 않는다.
  await apiFetch(editLockPath(documentId), { method: "DELETE" });
}
