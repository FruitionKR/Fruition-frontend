"use client";

import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";

/** 지원하지 않는 파일 업로드 시 표시하는 모달 (Figma 512:10792) */
export function UploadErrorModal({ onConfirm }: { onConfirm: () => void }) {
  return (
    <ConfirmModal
      titleId="upload-error-title"
      title="지원하지 않는 파일입니다."
      description="현재는 md, txt, pdf, zip 파일과 .md와 함께 고른 그림(png·jpg·gif·webp)만 지원합니다."
      confirmLabel="확인"
      hideCancel
      onConfirm={onConfirm}
      onCancel={onConfirm}
    />
  );
}
