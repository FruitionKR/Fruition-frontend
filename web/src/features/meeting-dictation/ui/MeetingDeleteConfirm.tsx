import { useEffect, useRef } from "react";
import { useModalFocus } from "@/shared/hooks/useModalFocus";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";

/** 회의 삭제 확인(시안 없음, 문서 삭제 확인 모달과 같은 모양). 열리면 취소 버튼에 포커스를 두고 Tab을 모달 안에 가둔다. */
export function MeetingDeleteConfirm({
  meetingName,
  hasRecording,
  onConfirm,
  onCancel
}: {
  meetingName: string;
  hasRecording: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(containerRef);
  useEffect(() => {
    containerRef.current?.querySelector<HTMLButtonElement>(".modal-cancel-button")?.focus();
  }, []);
  return (
    <div ref={containerRef}>
      <ConfirmModal
        titleId="meeting-delete-confirm-title"
        title="회의를 삭제하시겠습니까?"
        description={
          <>
            「{meetingName}」 회의의 대화 내용과 회의록 초안{hasRecording ? ", 녹음 파일" : ""}이 삭제됩니다.
            문서로 저장한 회의록은 남습니다. 이 작업은 되돌릴 수 없습니다.
          </>
        }
        confirmLabel="삭제"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  );
}
