import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { TreeItem } from "@/entities/tree/model/tree";

/** 최상위 폴더에 있는 중복 이름 문서의 접미사. */
export const ROOT_FOLDER_LABEL = "최상위";

/** 문서가 있는 폴더 경로("폴더/하위 폴더"). 최상위면 빈 문자열, 트리에 없으면 null. */
function findFolderPath(items: TreeItem[], documentId: string, ancestors: string[]): string | null {
  for (const item of items) {
    if (item.documentId === documentId) return ancestors.join("/");
    if (!item.children?.length) continue;
    const found = findFolderPath(item.children, documentId, [...ancestors, item.label]);
    if (found !== null) return found;
  }
  return null;
}

/**
 * 같은 파일명을 가진 문서가 둘 이상이면 문서 ID → 폴더 경로 접미사를 만든다.
 * 이름이 유일한 문서는 포함하지 않는다. 트리에서 찾지 못한 문서는 최상위로 본다.
 * 문서 이름은 폴더 안에서만 유일해 그래프 소스 노드 제목(파일명)이 겹칠 수 있다(#150).
 */
export function buildDocumentPathSuffixes(
  documents: DocumentItemResponse[],
  projects: ReadonlyArray<{ items: TreeItem[] }>
): Map<string, string> {
  const idsByName = new Map<string, string[]>();
  for (const document of documents) {
    const key = document.filename.toLowerCase();
    idsByName.set(key, [...(idsByName.get(key) ?? []), document.id]);
  }
  const suffixes = new Map<string, string>();
  for (const ids of idsByName.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const path = projects.map((project) => findFolderPath(project.items, id, [])).find((found) => found !== null) ?? "";
      suffixes.set(id, path || ROOT_FOLDER_LABEL);
    }
  }
  return suffixes;
}

/** 접미사가 있으면 `이름 · 폴더/경로`로 만든다. */
export function withPathSuffix(label: string, suffix: string | undefined): string {
  return suffix ? `${label} · ${suffix}` : label;
}
