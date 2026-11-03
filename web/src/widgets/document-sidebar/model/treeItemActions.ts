import { canDeleteDocument } from "@/entities/document/lib/documentAccess";
import { isFileItem, isWikiItem } from "@/entities/tree/lib/treeGuards";
import type { TreeItem } from "@/entities/tree/model/tree";

/** 트리 컨텍스트 메뉴(우클릭·행 ⋯·새 노트 추가) 항목. */
export type TreeMenuActionId =
  | "new-note"
  | "new-folder"
  | "upload"
  | "import-notion"
  | "convert"
  | "rename"
  | "permission"
  | "download"
  | "delete";

export const TREE_MENU_LABELS: Record<TreeMenuActionId, string> = {
  "new-note": "새 노트",
  "new-folder": "새 폴더",
  upload: "파일 업로드",
  "import-notion": "Notion에서 가져오기",
  convert: "Markdown으로 변환",
  rename: "이름 변경",
  permission: "권한 설정",
  download: "원본 다운로드",
  delete: "삭제"
};

export type TreeItemMenuAccess = {
  /** 새 노트·새 폴더·파일 업로드 등 생성 항목. 폴더·최상위에서만 연다(파일·위키 페이지에는 없다). */
  canCreateIn: boolean;
  /** PDF 원본·보기 전용·자동 생성·이름 잠김(채팅에서 만든 문서) 항목과 최상위는 이름을 바꿀 수 없다. */
  canRename: boolean;
  /** 서버 can_delete=false(문서 소유자·OWNER가 아님)면 막는다. 폴더는 서버가 판정한다. 위키 페이지는 트리에서 지우지 않는다. */
  canDelete: boolean;
  /** 문서·폴더 항목에서만. 누가 바꿀 수 있는지는 서버가 판정한다(403이면 다이얼로그가 안내). */
  canSetPermission: boolean;
  /** 올라간 PDF 원본이면 Markdown 변환을 보인다. 처리 중·변환 권한 없음은 이유와 함께 비활성으로 둔다(convertContextTarget). */
  canConvert: boolean;
  /** 서버에 올라간 파일의 원본을 내려받는다. 채팅에서 만든 문서는 출처 보존용이라 두지 않는다. */
  canDownload: boolean;
};

/** 메뉴 항목 노출 판정의 단일 기준. item이 null이면 최상위(isRootTarget) 또는 트리에서 찾지 못한 항목이다. */
export function treeItemMenuAccess(item: TreeItem | null, { isRootTarget }: { isRootTarget: boolean }): TreeItemMenuAccess {
  const isFile = item !== null && isFileItem(item);
  const isUploaded = Boolean(item?.documentId) && item?.status !== "uploading";
  const isPdf = isFile && item?.mimeType === "application/pdf";
  return {
    canCreateIn: item ? item.type === "folder" : isRootTarget,
    canRename: item !== null
      && item.mimeType !== "application/pdf"
      && item.canEdit !== false
      && !item.generated
      && !item.titleLocked,
    canDelete: item !== null && !isWikiItem(item) && canDeleteDocument({ can_delete: item.canDelete }),
    canSetPermission: Boolean(item && !isWikiItem(item) && item.status !== "uploading"),
    canConvert: isPdf && isUploaded,
    canDownload: isFile && isUploaded && !item?.titleLocked
  };
}

/**
 * 컨텍스트 메뉴 구성. 구역 사이에 구분선을 두고, 권한이 없는 항목과 빈 구역은 뺀다. 삭제는 늘 마지막 구역이다.
 * - 최상위: 새 노트 · 새 폴더 | 파일 업로드 · Notion에서 가져오기
 * - 폴더: 새 노트 · 새 폴더 | 파일 업로드 | 이름 변경 · 권한 설정 | 삭제
 * - 파일: (PDF) Markdown으로 변환 | 이름 변경 · 권한 설정 · 원본 다운로드 | 삭제
 * - 위키 페이지: 항목 없음(메뉴를 열지 않는다)
 */
export function treeContextMenuSections(
  item: TreeItem | null,
  { isRootTarget, canCreateProject, canImportNotion }: { isRootTarget: boolean; canCreateProject: boolean; canImportNotion: boolean }
): TreeMenuActionId[][] {
  const access = treeItemMenuAccess(item, { isRootTarget });
  const createSection = pick({ "new-note": access.canCreateIn, "new-folder": access.canCreateIn && canCreateProject });
  const sections = item === null
    ? [createSection, pick({ upload: access.canCreateIn, "import-notion": access.canCreateIn && canImportNotion })]
    : [
      createSection,
      pick({ upload: access.canCreateIn }),
      pick({ convert: access.canConvert }),
      pick({ rename: access.canRename, permission: access.canSetPermission, download: access.canDownload }),
      pick({ delete: access.canDelete })
    ];
  return sections.filter((section) => section.length > 0);
}

function pick(flags: Partial<Record<TreeMenuActionId, boolean>>): TreeMenuActionId[] {
  return (Object.keys(flags) as TreeMenuActionId[]).filter((id) => flags[id]);
}
