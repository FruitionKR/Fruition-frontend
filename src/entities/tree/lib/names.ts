import type { Project, TreeItem } from "../model/tree";
import { isFileItem, isWikiItem } from "./guards";

/** 폴더 위치와 무관하게 같은 워크스페이스의 이름을 비교한다. */
export function folderNames(projects: Project[], excludedId?: string): Set<string> {
  const names = new Set<string>();
  function visit(items: TreeItem[]) {
    for (const item of items) {
      if (item.id !== excludedId && !isFileItem(item) && !isWikiItem(item)) {
        names.add(normalizeTreeName(item.label));
      }
      if (item.children) visit(item.children);
    }
  }
  for (const project of projects) {
    if (project.id !== excludedId) names.add(normalizeTreeName(project.title));
    visit(project.items);
  }
  return names;
}

export function normalizeTreeName(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

export function availableFolderName(projects: Project[], base: string): string {
  const names = folderNames(projects);
  let name = base;
  for (let number = 2; names.has(normalizeTreeName(name)); number += 1) {
    name = `${base} (${number})`;
  }
  return name;
}

export function availableDocumentName(projects: Project[], filename: string): string {
  const names = new Set<string>();
  function visit(items: TreeItem[]) {
    for (const item of items) {
      if (isFileItem(item)) names.add(normalizeTreeName(item.label));
      if (item.children) visit(item.children);
    }
  }
  projects.forEach((project) => visit(project.items));
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  let candidate = filename;
  for (let number = 2; names.has(normalizeTreeName(candidate)); number += 1) {
    candidate = `${base} (${number})${extension}`;
  }
  return candidate;
}
