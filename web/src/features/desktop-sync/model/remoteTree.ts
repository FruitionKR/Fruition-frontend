import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { ServerTreeItem } from "@/entities/tree/model/serverTree";
import { isSyncablePath } from "@/features/desktop-sync/lib/syncNames";
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
 * readonlyIds는 저장이 403으로 거절된 문서처럼 앱이 올릴 수 없다고 알게 된 문서다. 서버가 can_edit을 주면 그 값이 우선한다.
 * 서버는 폴더 이름에 "."·".."·숨김 이름을 허용하므로, 로컬에서 동기화 대상이 될 수 없는 경로의 문서는 트리에서 뺀다.
 * 넣으면 숨김 폴더에 내려받은 뒤 다음 주기에 로컬 목록에서 빠져 서버 문서를 지우게 되고, ".."는 연결 폴더 밖에 쓰게 된다.
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
    if (!isSyncablePath(path)) continue;
    const document = item.document;
    index.files.push({
      documentId: item.id,
      path,
      // 본문 저장은 current_version을 올리지 않으므로 updated_at으로 변경을 판단한다. 없을 때만 버전으로 대신한다.
      updatedAt: document?.updated_at ?? `v${item.current_version}`,
      readonly: isReadonly(document, readonlyIds.has(item.id)),
      undeletable: document?.can_delete === false
    });
    index.documents.set(item.id, { currentVersion: item.current_version, folderId, filename: item.name });
  }
}

/**
 * 앱이 로컬 변경을 올릴 수 없는 문서인지.
 * - 편집 문서인데 종류상 편집할 수 없으면(채팅 문서 등) 읽기 전용이다. PDF 원본은 editable=false여도 교체할 수 있다.
 * - 서버가 현재 사용자 권한(can_edit, document#74)을 주면 그 값을 따른다. 주지 않는 구 서버에서만 403으로 거절된 기록을 쓴다.
 * - PDF 원본은 휴지통으로 보낸 뒤 다시 올려 교체하므로 삭제 권한(can_delete)이 없으면 읽기 전용이다.
 */
function isReadonly(document: DocumentItemResponse | undefined, rejectedBefore: boolean): boolean {
  if (!document) return rejectedBefore;
  if (document.document_role === "EDITABLE" && document.editable === false) return true;
  if (document.document_role === "ORIGINAL" && document.can_delete === false) return true;
  return document.can_edit === undefined ? rejectedBefore : !document.can_edit;
}
