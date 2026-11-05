import { folderWritable } from "@/entities/tree/lib/treePermission";
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
 * folderWritable로 따진다. 옮기는 작업은 목적지와 출발 폴더를 모두 쓸 수 있어야 하고 문서 소유자 예외가 없다.
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
    let current = typeof folderId === "string" ? index.get(folderId) : undefined;
    if (!current) return null;
    const chain: ServerTreeItem["permission"][] = [];
    while (current) {
      chain.push(current.item.permission);
      current = current.parentId === null ? undefined : index.get(current.parentId);
    }
    return folderWritable(chain, isWorkspaceOwner);
  }

  /** 옮기거나 만들 위치. null·생략은 최상위(멤버면 쓸 수 있다)이고, 이 계획이 만드는 폴더는 그 생성 작업에서 따진다. */
  function canUseDestination(folder: unknown): TriState {
    if (folder === null || folder === undefined) return true;
    if (typeof folder === "object" && "$operation_result" in folder) return true;
    return canEditFolder(folder);
  }

  /** 옮길 항목이 지금 있는 폴더에서 꺼낼 수 있는지. 트리에서 상위를 알 때만 판단한다. 최상위는 멤버면 된다. */
  function canLeaveSource(itemId: unknown): TriState {
    const entry = typeof itemId === "string" ? index.get(itemId) : undefined;
    if (!entry) return null;
    return entry.parentId === null ? true : canEditFolder(entry.parentId);
  }

  function isForbidden(operation: AgentPlanOperation): boolean {
    const args = operation.arguments;
    const checks: TriState[] = (() => {
      switch (operation.tool_name) {
        case "apply_document_edit":
        case "rename_document": return [canEditDocument(operation.target_id ?? args.document_id)];
        case "move_document": {
          const documentId = operation.target_id ?? args.document_id;
          return [canEditDocument(documentId), canLeaveSource(documentId), canUseDestination(args.folder_id)];
        }
        case "create_document": return [canUseDestination(args.folder_id)];
        case "create_folder": return [canUseDestination(args.parent_folder_id)];
        case "rename_folder": return [canEditFolder(operation.target_id ?? args.folder_id)];
        case "move_folder": {
          const folderId = operation.target_id ?? args.folder_id;
          return [canEditFolder(folderId), canLeaveSource(folderId), canUseDestination(args.parent_folder_id)];
        }
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

export type PlanRowAccess = Pick<PlanAccess, "verdict" | "blockedCount"> & {
  /** 고른 줄 중 작업 일부만 막혀 나머지는 실행될 줄 수. blockedCount는 모두 막힌 줄 수다. */
  partlyBlockedCount: number;
};

/**
 * 폴더 정리의 권한 판단을 줄 단위로 옮긴다. 화면이 "2개 중 2개 선택"처럼 줄을 세므로, 작업 수로 안내하면 어긋난다.
 * 고른 줄이 모두 막히면 새 폴더처럼 줄에 안 잡히는 작업이 남아도 all_blocked다(빈 폴더만 생기므로 수락을 막는다).
 */
export function checkRowAccess(
  access: Pick<PlanAccess, "blockedCount" | "blockedOperationIds">,
  rows: readonly { id: string; operationIds: readonly string[] }[],
  deselectedIds: ReadonlySet<string>
): PlanRowAccess {
  const selected = rows.filter((row) => !deselectedIds.has(row.id));
  const blockedOps = (row: { operationIds: readonly string[] }) => row.operationIds.filter((id) => access.blockedOperationIds.has(id)).length;
  const blockedCount = selected.filter((row) => row.operationIds.length > 0 && blockedOps(row) === row.operationIds.length).length;
  const partlyBlockedCount = selected.filter((row) => blockedOps(row) > 0 && blockedOps(row) < row.operationIds.length).length;
  if (selected.length === 0) return { verdict: "clear", blockedCount: 0, partlyBlockedCount: 0 };
  const verdict = blockedCount === selected.length ? "all_blocked"
    : blockedCount + partlyBlockedCount > 0 || access.blockedCount > 0 ? "some_blocked" : "clear";
  return { verdict, blockedCount, partlyBlockedCount };
}

const NO_ACCESS_REASON = "대상 문서를 편집하거나 폴더에 넣거나 꺼낼 권한이 없어";

/** 수락 전에 보여 줄 권한 안내. 막힌 작업이 없으면 null이다. unit은 세는 단위(폴더 정리 줄은 "항목")다. */
export function planAccessMessage({ verdict, blockedCount, partlyBlockedCount = 0, unit = "작업" }: Pick<PlanAccess, "verdict" | "blockedCount"> & { partlyBlockedCount?: number; unit?: string }): string | null {
  if (verdict === "all_blocked") {
    return `${NO_ACCESS_REASON} 수락해도 실행할 수 없어요. 워크스페이스 OWNER에게 권한을 요청해 주세요.`;
  }
  if (verdict === "some_blocked") {
    return [
      blockedCount > 0 && `${unit} ${blockedCount}개는 ${NO_ACCESS_REASON} 실행되지 않아요.`,
      partlyBlockedCount > 0 && `${unit} ${partlyBlockedCount}개는 권한이 없는 작업을 빼고 실행돼요.`,
      blockedCount === 0 && partlyBlockedCount === 0 && `일부 작업은 ${NO_ACCESS_REASON} 실행되지 않아요.`,
      `나머지 ${unit}만 실행돼요.`
    ].filter(Boolean).join(" ");
  }
  return null;
}

/** 항목별 안내 문구 */
export const PLAN_OPERATION_BLOCKED_NOTE = "문서를 편집하거나 폴더에 넣거나 꺼낼 권한이 없어 실행되지 않아요.";
/** 줄의 작업 중 일부만 막혔을 때의 안내 문구 */
export const PLAN_ROW_PARTLY_BLOCKED_NOTE = "일부 작업은 권한이 없어 실행되지 않아요.";
