import type { WorkspaceMember } from "@/entities/workspace/api/members";

export const UNKNOWN_WORKER_NAME = "알 수 없는 작업자";

export type LogWorker = { name: string; avatarUrl: string | null };

/** 로그 작업자 id → 멤버 목록의 이름·프로필 사진. 탈퇴했거나 목록에 없는 사용자는 기본 이름·사진(null)이다. */
export function buildLogWorkers(members: readonly WorkspaceMember[] | undefined): ReadonlyMap<string, LogWorker> {
  return new Map((members ?? []).map((member) => [
    member.user_id,
    { name: member.display_name || member.email || UNKNOWN_WORKER_NAME, avatarUrl: member.avatar_url ?? null }
  ]));
}

export function logWorkerOf(workers: ReadonlyMap<string, LogWorker>, userId: string): LogWorker {
  return workers.get(userId) ?? { name: UNKNOWN_WORKER_NAME, avatarUrl: null };
}
