"use client";

import { useTranslations } from "next-intl";
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
  const t = useTranslations("shared");
  const { items, skipped } = target;
  const names = items.slice(0, LISTED_LABEL_LIMIT).map((item) => t("ui.quotedName", { name: item.label })).join(", ");
  const rest = items.length - LISTED_LABEL_LIMIT;
  const hasFolder = items.some((item) => item.kind === "folder");
  const sentences = [
    rest > 0 ? t("ui.bulkDeleteConfirm.itemsWithRest", { names, rest }) : t("ui.bulkDeleteConfirm.items", { names }),
    hasFolder ? t("ui.bulkDeleteConfirm.folderNote") : null,
    skipped.length > 0 ? t("ui.bulkDeleteConfirm.skippedNote", { count: skipped.length }) : null,
    t("ui.bulkDeleteConfirm.trashNote")
  ];
  return (
    <ConfirmModal
      titleId="bulk-delete-confirm-title"
      title={t("ui.bulkDeleteConfirm.title", { count: items.length })}
      description={sentences.filter(Boolean).join(" ")}
      confirmLabel={t("ui.bulkDeleteConfirm.confirm", { count: items.length })}
      tone="danger"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
