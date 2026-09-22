import type { Project, TreeItem } from "../model/tree";
import { isWikiItem } from "./guards";
import { findTreeItem } from "./queries";

export type FolderLocation = { projectId: string; folderId: string | null };

export function normalizeTreeName(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

export function folderItems(projects: Project[], location: FolderLocation): TreeItem[] {
  const project = projects.find((item) => item.id === location.projectId);
  if (!project) return [];
  return location.folderId ? findTreeItem(project.items, location.folderId)?.children ?? [] : project.items;
}

export function findItemLocation(projects: Project[], itemId: string): FolderLocation | undefined {
  function visit(items: TreeItem[], location: FolderLocation): FolderLocation | undefined {
    for (const item of items) {
      if (item.id === itemId) return location;
      const nested = item.children && visit(item.children, { ...location, folderId: item.id });
      if (nested) return nested;
    }
  }
  for (const project of projects) {
    const location = visit(project.items, { projectId: project.id, folderId: null });
    if (location) return location;
  }
}

/** 파일과 폴더는 같은 부모 안에서 하나의 이름 공간을 공유한다. */
export function folderNames(projects: Project[], excludedId?: string, location?: FolderLocation): Set<string> {
  const rootNames = () => projects.flatMap((project) => project.folderId === null
    ? project.items.filter((item) => item.id !== excludedId && !isWikiItem(item)).map((item) => item.label)
    : project.id !== excludedId ? [project.title] : []);
  const isRoot = !location || location.folderId === null && projects.find((project) => project.id === location.projectId)?.folderId === null;
  return new Set((isRoot ? rootNames()
    : folderItems(projects, location!).filter((item) => item.id !== excludedId && !isWikiItem(item)).map((item) => item.label))
    .map(normalizeTreeName));
}

export function availableFolderName(projects: Project[], base: string, location?: FolderLocation): string {
  const names = folderNames(projects, undefined, location);
  let name = base;
  for (let number = 2; names.has(normalizeTreeName(name)); number += 1) name = `${base} (${number})`;
  return name;
}

export function availableDocumentName(projects: Project[], filename: string, location: FolderLocation): string {
  const names = folderNames(projects, undefined, location);
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  let candidate = filename;
  for (let number = 2; names.has(normalizeTreeName(candidate)); number += 1) candidate = `${base} (${number})${extension}`;
  return candidate;
}

/** 루트 문서 가상 그룹은 null, 실제 프로젝트·하위 폴더는 서버 UUID다. */
export function serverFolderId(projects: Project[], location: FolderLocation): string | null {
  return location.folderId ?? projects.find((project) => project.id === location.projectId)?.folderId ?? null;
}
