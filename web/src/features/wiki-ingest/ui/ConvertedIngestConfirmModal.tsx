import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";

/** 아직 편입하지 않은 PDF 변환본을 열었을 때 위키 편입을 묻는다. ESC·바깥 클릭은 AlertModal이 취소로 처리한다. */
export function ConvertedIngestConfirmModal({ filename, onConfirm, onCancel }: {
  filename: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmModal
      titleId="converted-ingest-confirm-title"
      title="이 문서를 위키에 편입할까요?"
      description={`"${filename}"은 PDF에서 변환한 Markdown입니다. 위키에 편입하면 채팅 답변의 근거로 쓸 수 있습니다.`}
      confirmLabel="확인"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
