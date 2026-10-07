import { ConfirmModal } from "@/shared/ui/ConfirmModal";

/** 위키 편입 선택에 변환 전 PDF가 섞였을 때 변환 후 편입을 확인한다. ESC·바깥 클릭은 AlertModal이 취소로 처리한다. */
export function PdfIngestConfirmModal({ pdfCount, onConfirm, onCancel }: {
  pdfCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmModal
      titleId="pdf-ingest-confirm-title"
      title="PDF를 변환한 뒤 위키에 편입할까요?"
      description={`선택한 PDF ${pdfCount}개는 먼저 Markdown으로 변환한 뒤 위키에 편입합니다. 변환에 시간이 걸릴 수 있습니다.`}
      confirmLabel="확인"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
