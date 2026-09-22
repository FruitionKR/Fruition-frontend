import { AlertModal } from "@/shared/ui/AlertModal";
import { useEscapeKey } from "@/shared/lib/useEscapeKey";

export function PdfIngestConfirmModal({ pdfCount, onConfirm, onCancel }: {
  pdfCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscapeKey(true, onCancel);
  return (
    <AlertModal
      titleId="pdf-ingest-confirm-title"
      title="PDF를 변환한 뒤 위키에 편입할까요?"
      description={`선택한 PDF ${pdfCount}개를 변환기로 Markdown으로 변환한 다음 위키에 편입합니다. 변환에 시간이 걸릴 수 있습니다.`}
      onClose={onCancel}
    >
      <div className="modal-actions">
        <button type="button" className="modal-cancel-button" onClick={onCancel}>취소</button>
        <button type="button" className="modal-confirm-button" onClick={onConfirm}>확인</button>
      </div>
    </AlertModal>
  );
}
