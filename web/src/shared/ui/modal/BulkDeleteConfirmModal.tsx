"use client";

import { ConfirmModal } from "./ConfirmModal";

/** 모달에 이름을 몇 개까지 나열할지. 나머지는 "외 N개"로 줄인다. */
const LISTED_LABEL_LIMIT = 5;

/** 여러 문서·폴더를 한 번에 삭제하기 전 확인 모달 (DeleteConfirmModal과 같은 ConfirmModal 패턴) */
export function BulkDeleteConfirmModal({
  target,
  onConfirm,
  onCancel
}: {
  target: { items: { label: string; kind: "folder" | "document" }[]; skipped: { label: string }[] };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { items, skipped } = target;
  const names = items.slice(0, LISTED_LABEL_LIMIT).map((item) => `「${item.label}」`).join(", ");
  const rest = items.length - LISTED_LABEL_LIMIT;
  const hasFolder = items.some((item) => item.kind === "folder");
  return (
    <ConfirmModal
      titleId="bulk-delete-confirm-title"
      title={`${items.length}개 항목을 삭제하시겠습니까?`}
      description={
        <>
          {names}{rest > 0 ? ` 외 ${rest}개` : ""} 항목이 삭제됩니다.
          {hasFolder && " 폴더는 폴더 안의 모든 항목도 함께 삭제됩니다."}
          {skipped.length > 0 && ` 삭제할 수 없는 ${skipped.length}개 항목은 건너뜁니다.`}
          {" "}이 작업은 되돌릴 수 없습니다.
        </>
      }
      confirmLabel={`${items.length}개 삭제`}
      tone="danger"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
