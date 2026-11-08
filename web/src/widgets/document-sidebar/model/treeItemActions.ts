import { canDeleteDocument } from "@/entities/document/lib/documentAccess";
import { canDragTreeItem, isFileItem } from "@/entities/tree/lib/treeGuards";
import {
  DOCUMENT_PERMISSION_FORBIDDEN_MESSAGE,
  FOLDER_EDIT_FORBIDDEN_MESSAGE,
  FOLDER_PERMISSION_OWNER_ONLY_MESSAGE,
  folderDeleteBlockedReason,
  FOLDER_WRITE_FORBIDDEN_MESSAGE
} from "@/entities/tree/lib/treePermission";
import type { TreeItem } from "@/entities/tree/model/tree";

/** 트리 컨텍스트 메뉴(우클릭·행 ⋯·새 노트 추가) 항목. */
export type TreeMenuActionId =
  | "new-note"
  | "new-folder"
  | "upload"
  | "import-notion"
  | "convert"
  | "rename"
  | "move"
  | "select"
  | "permission"
  | "download"
  | "delete";

/** 메뉴 항목의 메시지 키(documents.tree.menu.*) */
export const TREE_MENU_MESSAGE_KEYS = {
  "new-note": "newNote",
  "new-folder": "newFolder",
  upload: "upload",
  "import-notion": "importNotion",
  convert: "convert",
  rename: "rename",
  move: "move",
  select: "select",
  permission: "permission",
  download: "download",
  delete: "delete"
} as const satisfies Record<TreeMenuActionId, string>;

export type TreeItemMenuAccess = {
  /** 새 노트·새 폴더·파일 업로드 등 생성 항목. 폴더·최상위에서만 연다(파일에는 없다). */
  canCreateIn: boolean;
  /** PDF 원본·보기 전용·자동 생성·이름 잠김(채팅에서 만든 문서) 항목과 최상위는 이름을 바꿀 수 없다. */
  canRename: boolean;
  /** 서버 can_delete=false(문서 소유자·OWNER가 아님)면 뺀다. 폴더는 treeMenuBlockedActions가 이유와 함께 막는다. */
  canDelete: boolean;
  /** 문서·폴더 항목에서만. 알 수 있는 거절은 treeMenuBlockedActions가 막고, 나머지는 서버가 판정한다(403이면 다이얼로그가 안내). */
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
    canDelete: item !== null && canDeleteDocument({ can_delete: item.canDelete }),
    canSetPermission: Boolean(item && item.status !== "uploading"),
    canConvert: isPdf && isUploaded,
    canDownload: isFile && isUploaded && !item?.titleLocked
  };
}

/**
 * 컨텍스트 메뉴 구성. 구역 사이에 구분선을 두고, 권한이 없는 항목과 빈 구역은 뺀다. 삭제는 늘 마지막 구역이다.
 * - 최상위: 새 노트 · 새 폴더 | 파일 업로드 · Notion에서 가져오기
 * - 폴더: 새 노트 · 새 폴더 | 파일 업로드 | 이름 변경 · 권한 설정 | 삭제
 * - 파일: (PDF) Markdown으로 변환 | 이름 변경 · 권한 설정 · 원본 다운로드 | 삭제
 * canUseTouchActions(끌기·Cmd+클릭이 없는 터치 기기)이면 삭제 앞에 이동·여러 항목 선택 구역을 더한다.
 */
export function treeContextMenuSections(
  item: TreeItem | null,
  { isRootTarget, canCreateProject, canImportNotion, canUseTouchActions = false }: { isRootTarget: boolean; canCreateProject: boolean; canImportNotion: boolean; canUseTouchActions?: boolean }
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
      pick({ move: canUseTouchActions && canDragTreeItem(item), select: canUseTouchActions && canDragTreeItem(item) }),
      pick({ delete: access.canDelete })
    ];
  return sections.filter((section) => section.length > 0);
}

/**
 * 권한 때문에 비활성으로 둘 메뉴 항목과 그 이유(document DocumentAccessPolicy·FolderService·DocumentPermissionService와 같은 규칙).
 * 판정할 수 없으면(권한 필드 없음·역할 모름) 넣지 않아 열어 두고 서버 안내에 맡긴다.
 */
export function treeMenuBlockedActions(
  item: TreeItem | null,
  isFolderWriteDenied: (folderId: string) => boolean,
  moveDeniedReason: (itemId: string) => string | null = () => null,
  isWorkspaceOwner: boolean | null = null
): ReadonlyMap<TreeMenuActionId, string> {
  const blocked = new Map<TreeMenuActionId, string>();
  if (!item) return blocked;
  const moveReason = moveDeniedReason(item.id);
  if (item.type !== "folder") {
    if (moveReason) blocked.set("move", moveReason);
    // 문서 권한을 바꾸는 사람과 지우는 사람은 같다(문서 소유자·OWNER). 서버가 can_delete로 알려 준다.
    if (item.canDelete === false) blocked.set("permission", DOCUMENT_PERMISSION_FORBIDDEN_MESSAGE);
    return blocked;
  }
  const isDenied = isFolderWriteDenied(item.id);
  if (isDenied) {
    for (const action of ["new-note", "new-folder", "upload"] as const) blocked.set(action, FOLDER_WRITE_FORBIDDEN_MESSAGE);
    blocked.set("rename", FOLDER_EDIT_FORBIDDEN_MESSAGE);
  }
  if (moveReason) blocked.set("move", moveReason);
  if (isWorkspaceOwner === false) blocked.set("permission", FOLDER_PERMISSION_OWNER_ONLY_MESSAGE);
  const deleteReason = folderDeleteBlockedReason(item, isDenied, isWorkspaceOwner);
  if (deleteReason) blocked.set("delete", deleteReason);
  return blocked;
}

function pick(flags: Partial<Record<TreeMenuActionId, boolean>>): TreeMenuActionId[] {
  return (Object.keys(flags) as TreeMenuActionId[]).filter((id) => flags[id]);
}
