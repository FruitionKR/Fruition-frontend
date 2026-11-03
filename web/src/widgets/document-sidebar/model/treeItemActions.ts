import { canDeleteDocument } from "@/entities/document/lib/documentAccess";
import { isFileItem, isWikiItem } from "@/entities/tree/lib/treeGuards";
import type { TreeItem } from "@/entities/tree/model/tree";

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

/** 우클릭·행 ⋯·새 노트 추가 메뉴가 같은 기준으로 보일 동작을 정한다. item이 null이면 폴더 밖(최상위) 대상이다. */
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
