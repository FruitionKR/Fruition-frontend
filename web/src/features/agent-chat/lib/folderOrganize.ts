import type { AgentPlan } from "./agentPlan";

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
};

export type FolderOrganizeView = {
  rows: FolderOrganizeRow[];
  createdFolders: string[];
  /** 정리 대상 폴더(옮겨지는 항목이 가장 많이 있던 폴더). 알 수 없으면 null. */
  targetFolderName: string | null;
};

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
export function buildFolderOrganizeView(plan: AgentPlan, tree: PlanTreeItem[]): FolderOrganizeView {
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

  const rows = new Map<string, FolderOrganizeRow & { moved: boolean; renamed: boolean; edited: boolean }>();
  const createdFolders: string[] = [];
  const sourceParents = new Map<string, number>();

  for (const operation of [...plan.operations].sort((a, b) => a.sequence - b.sequence)) {
    const args = operation.arguments;
    const reason = operation.reason?.trim().normalize("NFC") ?? "";
    if (operation.tool_name === "create_folder") {
      createdFolderNames.set(operation.id, argName(args));
      createdFolders.push(argName(args));
      continue;
    }
    if (operation.tool_name === "create_document") {
      rows.set(operation.id, {
        id: operation.id, originalName: "", folderName: folderName(args.folder_id), newName: argName(args),
        changeLabel: "생성", reason, moved: false, renamed: false, edited: false
      });
      continue;
    }
    const targetId = operation.target_id;
    if (!targetId) continue;
    const item = items.get(targetId);
    const row = rows.get(targetId) ?? {
      id: targetId,
      originalName: item?.name ?? "항목 이름 확인 불가",
      folderName: item ? folderName(item.parentId) : "위치 확인 불가",
      newName: item?.name ?? "항목 이름 확인 불가",
      changeLabel: "",
      reason: "",
      moved: false,
      renamed: false,
      edited: false
    };
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
    rows.set(targetId, row);
  }

  const targetParentId = [...sourceParents.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    rows: [...rows.values()].map(({ moved, renamed, edited, ...row }) => ({
      ...row,
      changeLabel: row.changeLabel || [moved && "이동", renamed && "이름", edited && "편집"].filter(Boolean).join(" · ")
    })),
    createdFolders,
    targetFolderName: targetParentId ? items.get(targetParentId)?.name ?? null : null
  };
}

/** 안내 문구: "6개 중 5개 선택 • 새 폴더 3개(계획, 회의, 참고)가 만들어져요." */
export function folderOrganizeNotice(total: number, selected: number, createdFolders: string[]): string {
  const base = `${total}개 중 ${selected}개 선택`;
  return createdFolders.length > 0
    ? `${base} • 새 폴더 ${createdFolders.length}개(${createdFolders.join(", ")})가 만들어져요.`
    : base;
}

/**
 * 승인 API는 계획 전체(plan_version·operation_hash)만 받는다. 일부만 고른 상태로는 적용할 수 없다.
 * 항목별 승인 계약이 생기면 이 조건을 선택한 작업만 보내도록 바꾼다.
 */
export function canApplyFolderOrganizeSelection(total: number, selected: number): boolean {
  return selected === total;
}
