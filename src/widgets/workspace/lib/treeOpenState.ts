import { findTreeItem } from "@/entities/tree/lib/queries";
import type { ContextMenuState, Project } from "@/entities/tree/model/tree";

/** 사이드바 폴더 펼침 상태를 워크스페이스별로 같은 탭 안에서 유지하는 sessionStorage 키 */
export function treeOpenStorageKey(workspaceId: string) {
  return `fruition.tree-open.${workspaceId}`;
}

/** 저장된 값이 손상됐거나 형식이 다르면 모두 접힌 상태로 시작한다. */
export function parseTreeOpenIds(raw: string | null): ReadonlySet<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function serializeTreeOpenIds(openIds: ReadonlySet<string>) {
  return JSON.stringify([...openIds]);
}

export function toggleTreeOpenId(openIds: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(openIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** 이미 모두 펼쳐져 있으면 같은 Set을 돌려줘 불필요한 렌더·저장을 피한다. */
export function addTreeOpenIds(openIds: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> {
  if (ids.every((id) => openIds.has(id))) return openIds;
  return new Set([...openIds, ...ids]);
}

/** 컨텍스트 메뉴가 폴더를 가리키면 그 폴더 id. 새 항목을 만들 때 펼칠 대상이다. */
export function findContextFolderId(projects: Project[], contextMenu: ContextMenuState | null): string | null {
  if (!contextMenu?.itemId) return null;
  const project = projects.find((entry) => entry.id === contextMenu.projectId);
  const item = project ? findTreeItem(project.items, contextMenu.itemId) : undefined;
  return item?.type === "folder" ? item.id : null;
}
