import { findServerParent, findServerTreeItem, type ServerTreeItem } from "../model/serverTree";

/** 실제 폴더를 사용한다. 같은 위치에 있는 변환본만 옮기며 사용자가 다른 폴더로 옮긴 문서는 건드리지 않는다. */
export function conversionFolderPlan(items: ServerTreeItem[], sourceId: string) {
  const source = findServerTreeItem(items, sourceId);
  if (!source || source.type !== "document") throw new Error("PDF document is no longer available.");
  const parentId = findServerParent(items, sourceId) ?? null;
  const parent = parentId ? findServerTreeItem(items, parentId) : undefined;
  const siblings = parent?.children ?? items;
  const name = source.name.replace(/\.pdf$/i, "");
  const members = siblings.filter((item) => item.id === sourceId || item.document?.source_document_id === sourceId);
  // 이미 전용 폴더 안이면 재변환할 때 폴더를 겹쳐 만들지 않는다. 폴더 이름을 바꾼 경우도 유지한다.
  const isDedicated = parent && members.length === siblings.length &&
    (members.length > 1 || parent.name === name || parent.name.startsWith(`${name} (`));
  if (isDedicated) return { folderId: parent.id, parentId, name: parent.name, memberIds: members.map((item) => item.id) };
  const names = new Set(siblings.map((item) => item.name.toLocaleLowerCase()));
  let availableName = name;
  for (let n = 2; names.has(availableName.toLocaleLowerCase()); n++) availableName = `${name} (${n})`;
  return { folderId: null, parentId, name: availableName, memberIds: members.map((item) => item.id) };
}
