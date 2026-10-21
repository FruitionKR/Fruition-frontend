/**
 * 같은 폴더에 폴더 정리를 다시 실행했을 때 앞선 승인 대기 계획을 정리한다.
 * 서버는 run끼리 대체 처리를 하지 않아(AI는 같은 run 안의 계획 버전만 superseded로 바꾼다) 화면이 앞선 run을 거절한다.
 * 테스트가 직접 import하므로 다른 모듈을 import하지 않는다.
 */

/** 완료 묶음 행에 보일 상태 문구 */
export const SUPERSEDED_PLAN_LABEL = "새 실행으로 대체됨";

/**
 * 새 계획이 승인 대기에 도달했다고 볼 run 상태. 승인 뒤 실행·결과 상태도 승인 대기를 지난 것이다.
 * 거절·취소된 새 run은 앞선 계획을 대체하지 않는다.
 */
const PLAN_REACHED_APPROVAL_STATUSES: ReadonlySet<string> = new Set([
  "awaiting_approval", "executing", "verifying", "completed", "partial_failed", "conflicted", "rollback_failed"
]);

export type FolderPlanCandidate = {
  turnId: string | null;
  action: string | null;
  run: { status: string; target_folder_id?: string | null } | null;
};

export type FolderPlanSupersession = {
  /** 거절할 앞선 승인 대기 run의 turn */
  turnId: string;
  /** 그 계획을 대체한 가장 최근 run의 turn */
  supersededBy: string;
};

function folderOf(candidate: FolderPlanCandidate): string | null {
  if (candidate.action !== "folder_organize" || !candidate.turnId) return null;
  return candidate.run?.target_folder_id || null;
}

/**
 * 보낸 순서대로 놓인 작업에서, 뒤에 같은 대상 폴더(target_folder_id)의 새 계획이 승인 대기에 도달한
 * 앞선 승인 대기(awaiting_approval) 폴더 정리 run을 찾는다. 승인 처리 중·끝난 run, 대상 폴더를 모르는 run은 건드리지 않는다.
 * includeRejected면 이미 거절된 앞선 run도 담는다. 화면이 거절해 정리한 run을 새로 고침·다른 기기에서도
 * "새 실행으로 대체됨"으로 보이게 서버 상태로 다시 판정할 때 쓴다.
 */
export function supersededFolderPlans(
  candidates: readonly FolderPlanCandidate[],
  { includeRejected = false }: { includeRejected?: boolean } = {}
): FolderPlanSupersession[] {
  const latestReachedByFolder = new Map<string, string>();
  const result: FolderPlanSupersession[] = [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const folder = folderOf(candidate);
    if (!folder) continue;
    const newer = latestReachedByFolder.get(folder);
    const isReplaceable = candidate.run?.status === "awaiting_approval" || (includeRejected && candidate.run?.status === "rejected");
    if (newer && isReplaceable) result.push({ turnId: candidate.turnId!, supersededBy: newer });
    if (!newer && candidate.run && PLAN_REACHED_APPROVAL_STATUSES.has(candidate.run.status)) latestReachedByFolder.set(folder, candidate.turnId!);
  }
  return result.reverse();
}
