import { PDF_CONVERT_QUALITY_NOTICE } from "@/entities/document/lib/documentConversion";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";

/** PDF를 Markdown으로 변환하기 전에 변환 품질을 안내하고 확인받는다. ESC·바깥 클릭은 AlertModal이 취소로 처리한다. */
export function PdfConvertConfirmModal({ filename, onConfirm, onCancel }: {
  filename: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmModal
      titleId="pdf-convert-confirm-title"
      title="PDF를 Markdown으로 변환할까요?"
      description={`"${filename}": ${PDF_CONVERT_QUALITY_NOTICE} 변환할까요?`}
      confirmLabel="확인"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
