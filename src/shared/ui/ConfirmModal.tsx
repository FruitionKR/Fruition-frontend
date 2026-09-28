"use client";

import type { ReactNode } from "react";
import { AlertModal } from "./AlertModal";

/** AlertModal 위에 취소/확인 버튼 줄을 얹은 공통 확인 모달. */
export function ConfirmModal({
  titleId,
  title,
  description,
  confirmLabel,
  cancelLabel = "취소",
  tone = "default",
  hideCancel = false,
  onConfirm,
  onCancel
}: {
  titleId: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** danger는 삭제 버튼 스타일(modal-delete-button)을 사용한다. */
  tone?: "default" | "danger";
  /** 확인 버튼만 단독으로 노출한다(modal-actions 래퍼 없음). */
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmClass = tone === "danger" ? "modal-delete-button" : "modal-confirm-button";
  const confirmButton = (
    <button type="button" className={confirmClass} onClick={onConfirm}>{confirmLabel}</button>
  );
  return (
    <AlertModal titleId={titleId} title={title} description={description} onClose={onCancel}>
      {hideCancel ? (
        confirmButton
      ) : (
        <div className="modal-actions">
          <button type="button" className="modal-cancel-button" onClick={onCancel}>{cancelLabel}</button>
          {confirmButton}
        </div>
      )}
    </AlertModal>
  );
}
