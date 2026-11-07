"use client";

import { useTranslations } from "next-intl";
import { ConfirmModal } from "./ConfirmModal";

/** 문서/폴더 삭제 전 확인 모달 (ConfirmModal 재사용) */
export function DeleteConfirmModal({
  target,
  onConfirm,
  onCancel
}: {
  target: { label: string; kind: "folder" | "document" };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("shared");
  const isFolder = target.kind === "folder";
  return (
    <ConfirmModal
      titleId="delete-confirm-title"
      title={isFolder ? t("ui.deleteConfirm.folderTitle") : t("ui.deleteConfirm.documentTitle")}
      description={isFolder
        ? t("ui.deleteConfirm.folderDescription", { name: target.label })
        : t("ui.deleteConfirm.documentDescription", { name: target.label })}
      confirmLabel={t("ui.deleteConfirm.confirm")}
      tone="danger"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
