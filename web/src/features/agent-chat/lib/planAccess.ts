import type { ServerTreeItem } from "@/entities/tree/model/serverTree";
import type { AgentPlan, AgentPlanOperation } from "./agentPlan";

export type PlanAccess = {
  /** 고른 작업 중 clear: 막힌 것 없음(권한을 모르는 작업 포함), some_blocked: 일부만 막힘, all_blocked: 모두 막힘. */
  verdict: "clear" | "some_blocked" | "all_blocked";
  /** 고른 작업 중 실행되지 않을 작업 수 */
  blockedCount: number;
  /** 계획 전체에서 권한이 없어 실행되지 않을 작업(그 작업에 기대는 작업 포함). 항목별 안내에 쓴다. */
  blockedOperationIds: ReadonlySet<string>;
};

type TriState = boolean | null;

function indexTree(items: readonly ServerTreeItem[], parentId: string | null, index: Map<string, { item: ServerTreeItem; parentId: string | null }>) {
  for (const item of items) {
    index.set(item.id, { item, parentId });
    indexTree(item.children ?? [], item.id, index);
  }
}

/**
 * 계획을 실행해도 권한(403)으로 실패할 작업을 찾는다. 서버의 작업별 권한 검사(document AgentAutoApprovalPolicy.permitted,
 * DocumentAccessPolicy)와 같은 규칙이다. 문서는 서버가 계산한 can_edit을 쓰고, 폴더는 트리에 실제 권한 필드가 없어
 * 자기 설정 → 가장 가까운 상위 설정 → 기본 편집 순으로 따지며 워크스페이스 OWNER는 항상 편집할 수 있다.
 * 알 수 없는 경우(구 서버 응답, 트리에 없는 항목, 모르는 도구, 역할 확인 전)는 막지 않고 서버 판단에 맡긴다.
 *
 * @param isWorkspaceOwner 역할을 아직 모르면 null
 * @param selectedOperationIds 실행할 작업. null이면 계획 전체
 */
export function checkPlanAccess(
  plan: Pick<AgentPlan, "operations">,
  tree: readonly ServerTreeItem[],
  isWorkspaceOwner: boolean | null,
  selectedOperationIds: readonly string[] | null
): PlanAccess {
  const index = new Map<string, { item: ServerTreeItem; parentId: string | null }>();
  indexTree(tree, null, index);

  function canEditDocument(documentId: unknown): TriState {
    const entry = typeof documentId === "string" ? index.get(documentId) : undefined;
    return entry?.item.document?.can_edit ?? null;
  }

  function canEditFolder(folderId: unknown): TriState {
    if (isWorkspaceOwner === null) return null;
    if (isWorkspaceOwner) return true;
    let current = typeof folderId === "string" ? index.get(folderId) : undefined;
    if (!current) return null;
    while (current) {
      const { permission } = current.item;
      if (permission === undefined) return null;
      if (permission !== null) return permission === "edit";
      current = current.parentId === null ? undefined : index.get(current.parentId);
    }
    return true;
  }

  /** 옮기거나 만들 위치. null·생략은 최상위(멤버면 쓸 수 있다)이고, 이 계획이 만드는 폴더는 그 생성 작업에서 따진다. */
  function canUseDestination(folder: unknown): TriState {
    if (folder === null || folder === undefined) return true;
    if (typeof folder === "object" && "$operation_result" in folder) return true;
    return canEditFolder(folder);
  }

  function isForbidden(operation: AgentPlanOperation): boolean {
    const args = operation.arguments;
    const checks: TriState[] = (() => {
      switch (operation.tool_name) {
        case "apply_document_edit":
        case "rename_document": return [canEditDocument(operation.target_id ?? args.document_id)];
        case "move_document": return [canEditDocument(operation.target_id ?? args.document_id), canUseDestination(args.folder_id)];
        case "create_document": return [canUseDestination(args.folder_id)];
        case "create_folder": return [canUseDestination(args.parent_folder_id)];
        case "rename_folder": return [canEditFolder(operation.target_id ?? args.folder_id)];
        case "move_folder": return [canEditFolder(operation.target_id ?? args.folder_id), canUseDestination(args.parent_folder_id)];
        default: return [];
      }
    })();
    return checks.includes(false);
  }

  function dependencies(operation: AgentPlanOperation): string[] {
    const created = [operation.arguments.folder_id, operation.arguments.parent_folder_id].flatMap((value) =>
      value && typeof value === "object" && "$operation_result" in value ? [String(value.$operation_result)] : []);
    return [...(operation.depends_on ?? []), ...created];
  }

  const blocked = new Set(plan.operations.filter(isForbidden).map((operation) => operation.id));
  // 앞선 작업이 실패하면 그 작업에 기대는 작업은 건너뛴다(ai agent_worker dependency_failed). 사슬이 끝날 때까지 넓힌다.
  let grew = blocked.size > 0;
  while (grew) {
    const next = plan.operations.filter((operation) => !blocked.has(operation.id) && dependencies(operation).some((id) => blocked.has(id)));
    next.forEach((operation) => blocked.add(operation.id));
    grew = next.length > 0;
  }

  const selectedIds = selectedOperationIds ?? plan.operations.map((operation) => operation.id);
  const blockedCount = selectedIds.filter((id) => blocked.has(id)).length;
  const verdict = blockedCount === 0 ? "clear" : blockedCount === selectedIds.length ? "all_blocked" : "some_blocked";
  return { verdict, blockedCount, blockedOperationIds: blocked };
}

/** 수락 전에 보여 줄 권한 안내. 막힌 작업이 없으면 null이다. */
export function planAccessMessage({ verdict, blockedCount }: Pick<PlanAccess, "verdict" | "blockedCount">): string | null {
  if (verdict === "all_blocked") {
    return "대상 문서·폴더에 편집 권한이 없어 수락해도 실행할 수 없어요. 편집하려면 문서 소유자나 워크스페이스 OWNER에게 편집 권한을 요청해 주세요.";
  }
  if (verdict === "some_blocked") {
    return `작업 ${blockedCount}개는 대상 문서·폴더에 편집 권한이 없어 실행되지 않아요. 나머지 작업만 실행돼요.`;
  }
  return null;
}

/** 항목별 안내 문구 */
export const PLAN_OPERATION_BLOCKED_NOTE = "편집 권한이 없어 실행되지 않아요.";
