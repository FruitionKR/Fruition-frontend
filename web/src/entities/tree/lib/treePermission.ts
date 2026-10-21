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
