import { useWorkspaceRole } from "@/entities/workspace";
import { hasWorkspacePermission } from "@/shared/lib/workspacePermissions";

/** 본인의 위키 편입·위키 최신화 권한. true 있음 · false 없음 · null 역할 확인 중(getWikiActionGate 참고). */
export function useWikiActionPermissions(): { canIngest: boolean | null; canLint: boolean | null } {
  const workspaceRole = useWorkspaceRole();
  return {
    canIngest: hasWorkspacePermission(workspaceRole, "wiki.ingest"),
    canLint: hasWorkspacePermission(workspaceRole, "wiki.lint")
  };
}
