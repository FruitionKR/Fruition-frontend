import type { OperationChange, RestorePreviewResponse } from "./operationLog";

/**
 * 문서 편집 롤백 확인 문구. 서버(document DocumentRestorePlanner·DocumentRestoreApplier)는 이 작업만 빼지 않고
 * 작업 직전 revision의 본문 전체로 새 revision을 쌓는다. 그래서 작업 뒤에 저장한 수정은 누가 했든 현재 본문에서 함께 사라진다.
 * 작업 후 revision을 변경 내역으로 모르면 한 작업이 revision을 하나 올린 것으로 본다.
 */
export function documentRestoreMessage(
  description: string,
  { document_id, from_version, to_version }: NonNullable<RestorePreviewResponse["document"]>,
  changes: ReadonlyArray<Pick<OperationChange, "resource_type" | "resource_id" | "after_revision">>
): string {
  const change = changes.find((item) => item.resource_type === "document" && item.resource_id === document_id);
  const operationRevision = change?.after_revision ?? to_version + 1;
  const message = `${description} 문서를 ${from_version}에서 ${to_version} 버전으로 되돌립니다.`;
  return from_version > operationRevision
    ? `${message} 이 작업 뒤에 저장한 수정(직접 편집, 다른 멤버의 편집, 다른 AI 작업)도 함께 사라집니다.`
    : message;
}
