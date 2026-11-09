import { createFolder, fetchDocumentTree, moveDocument } from "./documentTree";
import { conversionFolderPlan } from "../lib/conversionFolder";
import { findServerParent } from "../model/serverTree";

/** 변환 요청 전에 원본과 기존 변환본을 실제 폴더로 모은다. 삭제나 문서 이름 변경은 하지 않는다. */
export async function prepareConversionFolder(sourceId: string): Promise<string> {
  const tree = await fetchDocumentTree();
  const plan = conversionFolderPlan(tree.items, sourceId);
  if (plan.folderId) return plan.folderId;
  const folder = await createFolder(plan.name, plan.parentId);
  for (const id of plan.memberIds) await moveDocument(id, folder.id);
  return folder.id;
}

export async function placeConvertedDocument(documentId: string, folderId: string): Promise<void> {
  const tree = await fetchDocumentTree();
  if (findServerParent(tree.items, documentId) !== folderId) await moveDocument(documentId, folderId);
}
