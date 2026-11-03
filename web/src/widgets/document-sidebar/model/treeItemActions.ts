import { canDeleteDocument } from "@/entities/document/lib/documentAccess";
import { isFileItem, isWikiItem } from "@/entities/tree/lib/treeGuards";
import type { TreeItem } from "@/entities/tree/model/tree";

/** 컨텍스트 메뉴와 행 hover 버튼이 함께 쓰는 항목 동작 문구. */
export const TREE_ITEM_ACTION_LABELS = {
  rename: "이름 변경",
  permission: "권한 설정",
  delete: "삭제",
  more: "더 보기"
} as const;

export type TreeItemActionId = "rename" | "permission" | "delete";

export type TreeItemMenuAccess = {
  /** 새 폴더·새 노트·파일 업로드 등 생성 항목. 파일(노트·PDF) 위에서는 숨긴다. */
  canCreateIn: boolean;
  /** PDF 원본·보기 전용·자동 생성 항목과 최상위는 이름을 바꿀 수 없다. */
  canRename: boolean;
  /** 서버 can_delete=false(문서 소유자·OWNER가 아님)면 막는다. 폴더는 서버가 판정한다. */
  canDelete: boolean;
  /** 문서·폴더 항목에서만. 누가 바꿀 수 있는지는 서버가 판정한다(403이면 다이얼로그가 안내). */
  canSetPermission: boolean;
};

/** 우클릭 메뉴·행 hover 버튼이 같은 기준으로 보일 동작을 정한다. item이 null이면 폴더 밖(최상위) 대상이다. */
export function treeItemMenuAccess(item: TreeItem | null, { isRootTarget }: { isRootTarget: boolean }): TreeItemMenuAccess {
  return {
    canCreateIn: !item || !isFileItem(item),
    canRename: !(isRootTarget && item === null)
      && item?.mimeType !== "application/pdf"
      && item?.canEdit !== false
      && !item?.generated,
    canDelete: canDeleteDocument(item ? { can_delete: item.canDelete } : null),
    canSetPermission: Boolean(item && !isWikiItem(item) && item.status !== "uploading")
  };
}

/** 트리 행 오른쪽 hover 버튼(이름 변경·권한 설정·삭제). 권한이 없는 동작은 빼고, 업로드 중·위키 행에는 두지 않는다. */
export function treeRowActions(item: TreeItem): { id: TreeItemActionId; label: string }[] {
  if (item.status === "uploading" || isWikiItem(item)) return [];
  const access = treeItemMenuAccess(item, { isRootTarget: false });
  const visible: Record<TreeItemActionId, boolean> = {
    rename: access.canRename,
    permission: access.canSetPermission,
    delete: access.canDelete
  };
  return (["rename", "permission", "delete"] as const)
    .filter((id) => visible[id])
    .map((id) => ({ id, label: TREE_ITEM_ACTION_LABELS[id] }));
}
