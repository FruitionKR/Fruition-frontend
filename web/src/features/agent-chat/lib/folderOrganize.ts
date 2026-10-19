import { isOperationNotSelected, type AgentPlan, type AgentPlanOperation } from "./agentPlan";

/** 폴더 정리 미리보기 화면을 여는 데 필요한 것: 계획을 조회할 turn과 사용자가 보낸 커맨드. */
export type FolderOrganizeRequest = {
  turnId: string;
  question: string | null;
};

type PlanTreeItem = {
  id: string;
  name: string;
  type?: "folder" | "document";
  children?: PlanTreeItem[];
};

export type FolderOrganizeRow = {
  /** 원래 항목 id. 새로 만드는 문서는 작업 id. */
  id: string;
  /** 바뀌기 전 이름. 새로 만드는 문서는 빈 문자열. */
  originalName: string;
  /** 정리 후 들어갈 폴더 이름. 최상위면 "최상위". */
  folderName: string;
  newName: string;
  changeLabel: string;
  reason: string;
  /** 이 줄에 묶인 작업 id(이동·이름 변경 등). 부분 승인에 모두 보낸다. */
  operationIds: string[];
  /** 기본 선택 여부: 묶인 작업이 모두 suggested_selected !== false일 때만 선택. */
  suggestedSelected: boolean;
  /** 중복 의심(duplicate_name) 안내 문장. 빨간 줄로 보여 준다. */
  duplicateWarning: string | null;
  /** 기본 선택에서 빠진 작업에 의존(depends_on_unselected)한다는 보조 안내. */
  dependencyNote: string | null;
  /** 부분 승인에서 고르지 않아 실행하지 않은 줄(작업이 모두 skipped·not_selected). */
  excluded: boolean;
};

export type FolderOrganizeCreatedFolder = { operationId: string; name: string };

export type FolderOrganizeView = {
  rows: FolderOrganizeRow[];
  createdFolders: FolderOrganizeCreatedFolder[];
  /** 정리 대상 폴더: run의 target_folder_id, 없으면 옮겨지는 항목이 가장 많이 있던 폴더. 알 수 없으면 null. */
  targetFolderName: string | null;
};

/** AI 계약: 부분 승인 operation_ids는 1~20개. */
export const MAX_SELECTED_OPERATIONS = 20;

type RowDraft = FolderOrganizeRow & { moved: boolean; renamed: boolean; edited: boolean; operations: AgentPlanOperation[] };

/**
 * 스킬 결과가 폴더 정리인지. agent turn 응답의 action이 "folder_organize"면 폴더·문서를 옮기고
 * 이름을 바꾸는 계획(run)이고, "markdown_edit" 등은 문서 편집 결과다.
 */
export function isFolderOrganizeAction(action: string | undefined): boolean {
  return action === "folder_organize";
}

/** "/file-organize 날짜_분류_제목 형식으로…" → 커맨드와 나머지(정리 규칙). 커맨드가 없으면 command는 null. */
export function parseSkillCommand(question: string | null | undefined): { command: string | null; rule: string } {
  const text = (question ?? "").trim().normalize("NFC");
  const match = /^(\/\S+)\s*([\s\S]*)$/.exec(text);
  return match ? { command: match[1], rule: match[2].trim() } : { command: null, rule: text };
}

function argName(args: Record<string, unknown>): string {
  return String(args.name ?? args.display_name ?? "").normalize("NFC");
}

/** 계획의 작업(폴더 생성·이동·이름 변경)을 항목별 한 줄로 묶는다. */
export function buildFolderOrganizeView(plan: AgentPlan, tree: PlanTreeItem[], targetFolderId?: string | null): FolderOrganizeView {
  const items = new Map<string, { name: string; parentId: string | null }>();
  function visit(nodes: PlanTreeItem[], parentId: string | null) {
    for (const node of nodes) {
      items.set(node.id, { name: node.name.normalize("NFC"), parentId });
      visit(node.children ?? [], node.id);
    }
  }
  visit(tree, null);

  const createdFolderNames = new Map<string, string>();
  function folderName(value: unknown): string {
    if (value === null || value === undefined) return "최상위";
    if (typeof value === "string") return items.get(value)?.name ?? "폴더 이름 확인 불가";
    if (typeof value === "object" && "$operation_result" in value) {
      return createdFolderNames.get(String(value.$operation_result)) ?? "새 폴더 이름 확인 불가";
    }
    return "위치 확인 불가";
  }

  const rows = new Map<string, RowDraft>();
  const createdFolders: FolderOrganizeCreatedFolder[] = [];
  const sourceParents = new Map<string, number>();

  for (const operation of [...plan.operations].sort((a, b) => a.sequence - b.sequence)) {
    const args = operation.arguments;
    const reason = operation.reason?.trim().normalize("NFC") ?? "";
    if (operation.tool_name === "create_folder") {
      createdFolderNames.set(operation.id, argName(args));
      createdFolders.push({ operationId: operation.id, name: argName(args) });
      continue;
    }
    if (operation.tool_name === "create_document") {
      rows.set(operation.id, {
        ...emptyRow(operation.id, "", folderName(args.folder_id), argName(args)),
        changeLabel: "생성", reason, operations: [operation]
      });
      continue;
    }
    const targetId = operation.target_id;
    if (!targetId) continue;
    const item = items.get(targetId);
    const row = rows.get(targetId) ?? emptyRow(
      targetId,
      item?.name ?? "항목 이름 확인 불가",
      item ? folderName(item.parentId) : "위치 확인 불가",
      item?.name ?? "항목 이름 확인 불가"
    );
    if (operation.tool_name.startsWith("move_")) {
      row.moved = true;
      row.folderName = folderName(operation.tool_name.endsWith("folder") ? args.parent_folder_id : args.folder_id);
      const sourceParentId = operation.source_parent_id ?? item?.parentId ?? null;
      if (sourceParentId) sourceParents.set(sourceParentId, (sourceParents.get(sourceParentId) ?? 0) + 1);
    } else if (operation.tool_name.startsWith("rename_")) {
      row.renamed = true;
      row.newName = argName(args);
    } else if (operation.tool_name === "apply_document_edit") {
      row.edited = true;
    } else {
      continue;
    }
    if (reason && !row.reason) row.reason = reason;
    row.operations.push(operation);
    rows.set(targetId, row);
  }

  const targetParentId = (targetFolderId && items.has(targetFolderId) ? targetFolderId : null)
    ?? [...sourceParents.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    rows: [...rows.values()].map(({ moved, renamed, edited, operations, ...row }) => ({
      ...row,
      changeLabel: row.changeLabel || [moved && "이동", renamed && "이름", edited && "편집"].filter(Boolean).join(" · "),
      operationIds: operations.map((operation) => operation.id),
      suggestedSelected: operations.every((operation) => operation.suggested_selected !== false),
      duplicateWarning: warningMessage(operations, "duplicate_name"),
      dependencyNote: warningMessage(operations, "depends_on_unselected"),
      excluded: operations.every(isOperationNotSelected)
    })),
    createdFolders,
    targetFolderName: targetParentId ? items.get(targetParentId)?.name ?? null : null
  };
}

function emptyRow(id: string, originalName: string, folderName: string, newName: string): RowDraft {
  return {
    id, originalName, folderName, newName, changeLabel: "", reason: "", operationIds: [], suggestedSelected: true,
    duplicateWarning: null, dependencyNote: null, excluded: false, moved: false, renamed: false, edited: false, operations: []
  };
}

function warningMessage(operations: AgentPlanOperation[], type: string): string | null {
  return operations.find((operation) => operation.warning?.type === type)?.warning?.message.trim().normalize("NFC") || null;
}

/** 처음 열 때 선택을 해제해 둘 줄: 묶인 작업 중 하나라도 suggested_selected가 false인 줄. */
export function initialDeselectedRowIds(rows: FolderOrganizeRow[]): Set<string> {
  return new Set(rows.filter((row) => !row.suggestedSelected).map((row) => row.id));
}

function referencedOperationIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(referencedOperationIds);
  if (!value || typeof value !== "object") return [];
  if ("$operation_result" in value) return [String(value.$operation_result)];
  return Object.values(value).flatMap(referencedOperationIds);
}

/**
 * 부분 승인으로 보낼 작업 id. 고른 줄의 작업을 모두 넣고, 그 작업이 기대는 작업(depends_on·새 폴더 참조)도
 * 함께 넣는다(빠지면 AI가 400으로 거절). 모든 줄을 골랐으면 null(계획 전체 승인)이다.
 */
export function folderOrganizeSelection(plan: AgentPlan, rows: FolderOrganizeRow[], selectedRowIds: ReadonlySet<string>): string[] | null {
  if (rows.every((row) => selectedRowIds.has(row.id))) return null;
  const operations = new Map(plan.operations.map((operation) => [operation.id, operation]));
  const selected = new Set<string>();
  const pending = rows.filter((row) => selectedRowIds.has(row.id)).flatMap((row) => row.operationIds);
  while (pending.length > 0) {
    const operationId = pending.pop()!;
    const operation = operations.get(operationId);
    if (!operation || selected.has(operationId)) continue;
    selected.add(operationId);
    pending.push(...(operation.depends_on ?? []), ...referencedOperationIds(operation.arguments));
  }
  return [...plan.operations].sort((a, b) => a.sequence - b.sequence).map((operation) => operation.id).filter((operationId) => selected.has(operationId));
}

/** 선택에 따라 실제로 만들어질 새 폴더. operationIds가 null(전체)이면 모두. */
export function selectedCreatedFolders(createdFolders: FolderOrganizeCreatedFolder[], operationIds: readonly string[] | null): string[] {
  return createdFolders.filter((folder) => !operationIds || operationIds.includes(folder.operationId)).map((folder) => folder.name);
}

/** 안내 문구: "6개 중 5개 선택 • 1개는 중복 의심이라 선택 해제해 두었어요 • 새 폴더 3개(계획, 회의, 참고)가 만들어져요." */
export function folderOrganizeNotice(total: number, selected: number, createdFolders: string[], duplicateDeselected = 0): string {
  return [
    `${total}개 중 ${selected}개 선택`,
    duplicateDeselected > 0 && `${duplicateDeselected}개는 중복 의심이라 선택 해제해 두었어요`,
    createdFolders.length > 0 && `새 폴더 ${createdFolders.length}개(${createdFolders.join(", ")})가 만들어져요.`
  ].filter(Boolean).join(" • ");
}

/**
 * 적용 가능 여부. 하나 이상 골라야 하고, 일부만 고른 부분 승인은 AI 계약상 작업 20개까지다.
 * operationIds가 null이면 계획 전체 승인이라 개수 제한이 없다.
 */
export function canApplyFolderOrganizeSelection(selectedRows: number, operationIds: readonly string[] | null): boolean {
  return selectedRows > 0 && (operationIds === null || (operationIds.length > 0 && operationIds.length <= MAX_SELECTED_OPERATIONS));
}
