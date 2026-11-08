"use client";

import { useTranslations } from "next-intl";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";

/** 지원하지 않는 파일 업로드 시 표시하는 모달 (Figma 512:10792) */
export function UploadErrorModal({ onConfirm }: { onConfirm: () => void }) {
  const t = useTranslations("documents.upload.unsupported");
  return (
    <ConfirmModal
      titleId="upload-error-title"
      title={t("title")}
      description={t("description")}
      confirmLabel={t("confirm")}
      hideCancel
      onConfirm={onConfirm}
      onCancel={onConfirm}
    />
  );
}
