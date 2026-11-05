import type { TreeItem } from "../model/tree";

type Access = NonNullable<TreeItem["permission"]>;

/** 상위 폴더에서 내려오는 권한. 가장 가까운 "자기 권한이 있는" 상위 폴더 하나만 기억한다. */
export type InheritedPermission = { access: Access; fromFolderName: string } | null;

/** 트리 행에 보여줄 적용 권한. own은 자기 설정, inherited는 상위 폴더 설정을 따른 값이다. */
export type EffectivePermission =
  | { access: Access; source: "own"; fromFolderName: null }
  | { access: Access; source: "inherited"; fromFolderName: string }
  | null;

/** 자기 권한이 있으면 그 값, 없으면(null·필드 없음) 상위 폴더에서 받은 값, 둘 다 없으면 null. */
export function effectivePermission(item: Pick<TreeItem, "permission">, inherited: InheritedPermission): EffectivePermission {
  if (item.permission) return { access: item.permission, source: "own", fromFolderName: null };
  if (inherited) return { access: inherited.access, source: "inherited", fromFolderName: inherited.fromFolderName };
  return null;
}

/** 이 항목의 자식이 물려받을 권한. 폴더가 자기 권한을 가지면 그 폴더가 새 출처가 된다. */
export function permissionForChildren(item: Pick<TreeItem, "permission" | "label">, inherited: InheritedPermission): InheritedPermission {
  return item.permission ? { access: item.permission, fromFolderName: item.label } : inherited;
}

/** 트리에서 id 항목의 적용 권한을 찾는다. 없는 id면 undefined. */
export function findEffectivePermission(items: TreeItem[], id: string, inherited: InheritedPermission = null): EffectivePermission | undefined {
  for (const item of items) {
    if (item.id === id) return effectivePermission(item, inherited);
    const found = findEffectivePermission(item.children ?? [], id, permissionForChildren(item, inherited));
    if (found !== undefined) return found;
  }
}

/** 서버가 폴더 넣기·꺼내기를 거절할 때와 같은 문구. 화면에서 미리 막을 때 이유로 보여 준다. */
export const FOLDER_WRITE_FORBIDDEN_MESSAGE = "이 폴더에 넣거나 꺼낼 권한이 없습니다.";

/** 폴더 자체의 이름 변경·이동·삭제를 서버가 거절할 때와 같은 문구. */
export const FOLDER_EDIT_FORBIDDEN_MESSAGE = "이 폴더를 편집할 권한이 없습니다.";
export const FOLDER_WITH_ITEMS_DELETE_MESSAGE = "내용이 있는 폴더는 워크스페이스 OWNER만 삭제할 수 있습니다.";
export const FOLDER_PERMISSION_OWNER_ONLY_MESSAGE = "폴더 권한은 워크스페이스 OWNER만 바꿀 수 있습니다.";
export const DOCUMENT_PERMISSION_FORBIDDEN_MESSAGE = "문서 권한은 문서 소유자와 워크스페이스 OWNER만 바꿀 수 있습니다.";

/**
 * 이 폴더를 지울 수 없는 이유. 지울 수 있거나 모르면 null이고 서버가 판단한다.
 * 보기 폴더는 편집 권한이, 내용이 있는 폴더는 OWNER 역할이 필요하다(document FolderService).
 */
export function folderDeleteBlockedReason(folder: Pick<TreeItem, "children">, isWriteDenied: boolean, isWorkspaceOwner: boolean | null): string | null {
  if (isWriteDenied) return FOLDER_EDIT_FORBIDDEN_MESSAGE;
  return isWorkspaceOwner === false && (folder.children?.length ?? 0) > 0 ? FOLDER_WITH_ITEMS_DELETE_MESSAGE : null;
}

/**
 * 폴더에 항목을 넣거나 꺼낼 수 있는지 판정하는 단일 기준(서버 DocumentAccessPolicy와 같은 규칙).
 * chain은 그 폴더부터 최상위 쪽으로 올라가는 각 폴더의 자기 설정이다. 가장 가까운 설정을 따르고, 설정이 없으면 편집할 수 있다.
 * 문서 소유자 예외는 없고 워크스페이스 OWNER는 항상 된다.
 *
 * @param isWorkspaceOwner 역할을 아직 모르면 null
 * @returns 모르면(역할 확인 전, permission 필드가 없는 구 서버 응답) null. 호출자는 막지 않고 서버 판단에 맡긴다.
 */
export function folderWritable(chain: readonly TreeItem["permission"][], isWorkspaceOwner: boolean | null): boolean | null {
  if (isWorkspaceOwner === null) return null;
  if (isWorkspaceOwner) return true;
  for (const permission of chain) {
    if (permission === undefined) return null;
    if (permission !== null) return permission === "edit";
  }
  return true;
}

function folderPermissionChain(items: readonly TreeItem[], folderId: string): TreeItem["permission"][] | null {
  for (const item of items) {
    if (item.id === folderId) return [item.permission];
    const inner = folderPermissionChain(item.children ?? [], folderId);
    if (inner) return [...inner, item.permission];
  }
  return null;
}

/** 트리에서 folderWritable을 판정한다. folderId가 null이면 최상위로, 멤버면 쓸 수 있다. 트리에 없는 폴더는 모른다(null). */
export function canWriteTreeFolder(items: readonly TreeItem[], folderId: string | null, isWorkspaceOwner: boolean | null): boolean | null {
  if (folderId === null) return true;
  const chain = folderPermissionChain(items, folderId);
  return chain && folderWritable(chain, isWorkspaceOwner);
}
