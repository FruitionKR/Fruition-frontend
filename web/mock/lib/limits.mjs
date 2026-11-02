// 사용자별 저장 용량·무료 워크스페이스 소유 한도. 파일 하나의 크기는 제한하지 않는다. 백엔드 기본값을 흉내 낸다.
import { state } from "../state.mjs";

const GB = 1024 * 1024 * 1024;

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

/** 사용자별 저장 용량 기본값. MOCK_STORAGE_LIMIT_BYTES로 바꾸고, "none"이면 한도를 끈다(limit_bytes: null). */
function storageLimitBytes() {
  const configured = process.env.MOCK_STORAGE_LIMIT_BYTES;
  if (configured === "none") return null;
  const value = Number(configured);
  return configured && Number.isFinite(value) && value >= 0 ? value : 5 * GB;
}

/** 삭제되지 않은 워크스페이스에서 이 사용자가 올린 문서 원본과 본문 첨부 이미지 바이트 합(모든 워크스페이스 합산) */
function usedBytes(userId) {
  const isLive = (workspaceId) => state.workspaces.some((workspace) => workspace.id === workspaceId && !workspace.deleted_at);
  const documents = state.documents
    .filter((doc) => doc.owner_user_id === userId && !doc.deleted_at && isLive(doc.workspace_id))
    .reduce((sum, doc) => sum + (doc.byte_size ?? 0), 0);
  const assets = state.assets
    .filter((asset) => asset.owner_user_id === userId && isLive(asset.workspace_id))
    .reduce((sum, asset) => sum + (asset.buffer?.length ?? 0), 0);
  return documents + assets;
}

/** GET /api/workspaces/:wid/storage 응답. 용량은 워크스페이스가 아니라 사용자 단위다. */
export function storageOf(userId) {
  return { used_bytes: usedBytes(userId), limit_bytes: storageLimitBytes(), scope: "user" };
}

/** 업로드 거절 사유. 통과하면 null이다. */
export function uploadRejection(userId, byteSize) {
  const storage = storageOf(userId);
  if (storage.limit_bytes !== null && storage.used_bytes + byteSize > storage.limit_bytes) {
    return { status: 413, code: "STORAGE_QUOTA_EXCEEDED", message: "저장 공간이 부족합니다." };
  }
  return null;
}
