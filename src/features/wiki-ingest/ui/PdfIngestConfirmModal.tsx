import { ConfirmModal } from "@/shared/ui/ConfirmModal";
import { useEscapeKey } from "@/shared/lib/useEscapeKey";

export function PdfIngestConfirmModal({ pdfCount, onConfirm, onCancel }: {
  pdfCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscapeKey(true, onCancel);
  return (
    <ConfirmModal
      titleId="pdf-ingest-confirm-title"
      title="PDF를 변환한 뒤 위키에 편입할까요?"
      description={`선택한 PDF ${pdfCount}개를 변환기로 Markdown으로 변환한 다음 위키에 편입합니다. 변환에 시간이 걸릴 수 있습니다.`}
      confirmLabel="확인"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
