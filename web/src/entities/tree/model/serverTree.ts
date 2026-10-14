import type { DocumentItemResponse } from "@/entities/document/model/document";

export type ServerTreeItem = {
  type: "folder" | "document";
  id: string;
  name: string;
  sort_order: number;
  current_version: number;
  children?: ServerTreeItem[];
  document?: DocumentItemResponse;
};
export type DocumentTreeResponse = { items: ServerTreeItem[] };
export type FolderResponse = { id: string; name: string; parent_folder_id: string | null; current_version: number; sort_order: number };

export function findServerTreeItem(items: ServerTreeItem[], id: string): ServerTreeItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const child = findServerTreeItem(item.children ?? [], id);
    if (child) return child;
  }
}

export function findServerParent(items: ServerTreeItem[], id: string, parentId: string | null = null): string | null | undefined {
  for (const item of items) {
    if (item.id === id) return parentId;
    const found = findServerParent(item.children ?? [], id, item.id);
    if (found !== undefined) return found;
  }
}
