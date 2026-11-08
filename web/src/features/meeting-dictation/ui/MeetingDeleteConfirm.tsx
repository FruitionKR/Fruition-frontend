import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("meeting");
  const containerRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(containerRef);
  useEffect(() => {
    containerRef.current?.querySelector<HTMLButtonElement>(".modal-cancel-button")?.focus();
  }, []);
  return (
    <div ref={containerRef}>
      <ConfirmModal
        titleId="meeting-delete-confirm-title"
        title={t("deleteConfirm.title")}
        description={t("deleteConfirm.description", { name: meetingName, hasRecording: hasRecording ? "true" : "false" })}
        confirmLabel={t("deleteConfirm.confirm")}
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  );
}
