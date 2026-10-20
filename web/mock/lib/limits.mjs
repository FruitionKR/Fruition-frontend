// 플랜별 저장 용량·무료 워크스페이스 소유 한도. 파일 하나의 크기는 제한하지 않는다. 백엔드 요구사항 문서의 제안값을 흉내 낸다.
import { state } from "../state.mjs";

const GB = 1024 * 1024 * 1024;

// PRO·TEAM은 가격과 함께 정할 초안 값이다.
const PLAN_LIMIT_BYTES = { FREE: 1 * GB, PRO: 20 * GB, TEAM: 100 * GB };

export const FREE_WORKSPACE_LIMIT = 3;

/** 워크스페이스 플랜. 시드·생성 데이터에 값이 없으면 무료다. */
function planOf(workspace) {
  return workspace.plan ?? "FREE";
}

/** 사용자가 OWNER인 무료 워크스페이스 수 */
export function freeWorkspaceCount(userId) {
  return state.members.filter((member) => {
    if (member.user_id !== userId || member.role !== "OWNER") return false;
    const workspace = state.workspaces.find((item) => item.id === member.workspace_id && !item.deleted_at);
    return workspace && planOf(workspace) === "FREE";
  }).length;
}

/** 삭제되지 않은 문서 원본과 본문 첨부 이미지 바이트 합 */
function usedBytes(workspaceId) {
  const documents = state.documents
    .filter((doc) => doc.workspace_id === workspaceId && !doc.deleted_at)
    .reduce((sum, doc) => sum + (doc.byte_size ?? 0), 0);
  const assets = state.assets
    .filter((asset) => asset.workspace_id === workspaceId)
    .reduce((sum, asset) => sum + (asset.buffer?.length ?? 0), 0);
  return documents + assets;
}

/** 플랜·사용량·용량. 업로드 거절(STORAGE_QUOTA_EXCEEDED) 판단에 쓴다. */
function storageOf(workspace) {
  const plan = planOf(workspace);
  return { plan, used_bytes: usedBytes(workspace.id), limit_bytes: PLAN_LIMIT_BYTES[plan] };
}

/** 업로드 거절 사유. 통과하면 null이다. */
export function uploadRejection(workspace, byteSize) {
  const storage = storageOf(workspace);
  if (storage.used_bytes + byteSize > storage.limit_bytes) {
    return { status: 413, code: "STORAGE_QUOTA_EXCEEDED", message: "워크스페이스 저장 공간이 부족합니다." };
  }
  return null;
}
