import type { ServerTreeItem } from "@/entities/tree/model/serverTree";
import type { RemoteFile } from "@/features/desktop-sync/model/planSync";

export type RemoteTreeIndex = {
  files: RemoteFile[];
  /** 폴더 상대 경로("자료/회의록") → 폴더. 업로드·이동할 상위 폴더를 찾는다. */
  folders: Map<string, { id: string; currentVersion: number }>;
  /** 문서 id → 트리 작업(이동·삭제)에 보낼 버전과 현재 위치. */
  documents: Map<string, { currentVersion: number; folderId: string | null; filename: string }>;
};

/**
 * 서버 문서 트리를 동기화 계획의 입력으로 펼친다.
 * readonlyIds는 저장이 403으로 거절된 문서처럼 앱이 올릴 수 없다고 알게 된 문서다.
 */
export function indexRemoteTree(items: ServerTreeItem[], readonlyIds: ReadonlySet<string>): RemoteTreeIndex {
  const index: RemoteTreeIndex = { files: [], folders: new Map(), documents: new Map() };
  visit(items, "", null, readonlyIds, index);
  return index;
}

function visit(items: ServerTreeItem[], parentPath: string, folderId: string | null, readonlyIds: ReadonlySet<string>, index: RemoteTreeIndex) {
  for (const item of items) {
    const path = parentPath ? `${parentPath}/${item.name}` : item.name;
    if (item.type === "folder") {
      index.folders.set(path, { id: item.id, currentVersion: item.current_version });
      visit(item.children ?? [], path, item.id, readonlyIds, index);
      continue;
    }
    const document = item.document;
    // PDF 원본은 editable=false여도 소유자가 교체할 수 있다. 편집 문서인데 편집할 수 없을 때만(채팅 문서 등) 읽기 전용이다.
    const notEditable = document?.document_role === "EDITABLE" && document.editable === false;
    index.files.push({
      documentId: item.id,
      path,
      // 본문 저장은 current_version을 올리지 않으므로 updated_at으로 변경을 판단한다. 없을 때만 버전으로 대신한다.
      updatedAt: document?.updated_at ?? `v${item.current_version}`,
      readonly: notEditable || readonlyIds.has(item.id)
    });
    index.documents.set(item.id, { currentVersion: item.current_version, folderId, filename: item.name });
  }
}
