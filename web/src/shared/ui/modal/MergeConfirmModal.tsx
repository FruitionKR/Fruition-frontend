"use client";

import { useTranslations } from "next-intl";
import { ConfirmModal } from "./ConfirmModal";

/** 문서 위에 문서를 놓아 새 묶음 폴더를 만들기 전 확인 모달 (ConfirmModal 재사용) */
export function MergeConfirmModal({
  target,
  onConfirm,
  onCancel
}: {
  target: { sourceLabel: string; targetLabel: string };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("shared");
  return (
    <ConfirmModal
      titleId="merge-confirm-title"
      title={t("ui.mergeConfirm.title")}
      description={t("ui.mergeConfirm.description", { source: target.sourceLabel, target: target.targetLabel })}
      confirmLabel={t("ui.mergeConfirm.confirm")}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
