"use client";

import { ConfirmModal } from "@/shared/ui/ConfirmModal";

/** 지원하지 않는 파일 업로드 시 표시하는 모달 (Figma 512:10792) */
export function UploadErrorModal({ onConfirm }: { onConfirm: () => void }) {
  return (
    <ConfirmModal
      titleId="upload-error-title"
      title="지원하지 않는 파일입니다."
      description="현재는 md, txt, pdf 파일만 지원합니다."
      confirmLabel="확인"
      hideCancel
      onConfirm={onConfirm}
      onCancel={onConfirm}
    />
  );
}
