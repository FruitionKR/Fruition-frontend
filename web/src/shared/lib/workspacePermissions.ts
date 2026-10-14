import { WORKSPACE_PERMISSION_LABELS, type WorkspacePermission } from "./apiErrors";

export { findRequiredPermission, workspacePermissionLabel, type WorkspacePermission } from "./apiErrors";

/**
 * 워크스페이스 멤버 권한 항목(access #32, ADR 0019). OWNER는 항상 전부 가지고, MEMBER는 OWNER가 부여한 항목만 가진다.
 * 값은 서버 계약 그대로이고, 라벨은 apiErrors.ts의 403 안내 문구와 같은 것을 쓴다.
 */
const WORKSPACE_PERMISSION_DESCRIPTIONS: Record<WorkspacePermission, string> = {
  "wiki.ingest": "문서를 팀 위키에 편입합니다. 채팅 내보내기 문서의 편입도 포함됩니다.",
  "wiki.lint": "팀 위키 전체를 정리(lint)합니다.",
  "skill.author": "팀 스킬을 작성하고 게시합니다.",
  "wiki.restore": "다른 멤버가 실행한 AI 작업을 되돌립니다. 본인 작업은 항상 되돌릴 수 있습니다.",
  "document.convert": "다른 멤버가 올린 PDF를 변환합니다. 본인이 올린 파일은 항상 변환할 수 있습니다."
};

export const ALL_WORKSPACE_PERMISSIONS = Object.keys(WORKSPACE_PERMISSION_LABELS) as readonly WorkspacePermission[];

export const WORKSPACE_PERMISSIONS: readonly { value: WorkspacePermission; label: string; description: string }[] =
  ALL_WORKSPACE_PERMISSIONS.map((value) => ({ value, label: WORKSPACE_PERMISSION_LABELS[value], description: WORKSPACE_PERMISSION_DESCRIPTIONS[value] }));
