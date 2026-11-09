"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertModal } from "./AlertModal";

/** AlertModal 위에 취소/확인 버튼 줄을 얹은 공통 확인 모달. */
export function ConfirmModal({
  titleId,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "default",
  hideCancel = false,
  busy = false,
  children,
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
  busy?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("shared");
  const confirmClass = tone === "danger" ? "modal-delete-button" : "modal-confirm-button";
  const confirmButton = (
    <button type="button" className={confirmClass} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
  );
  return (
    <AlertModal titleId={titleId} title={title} description={description} onClose={() => { if (!busy) onCancel(); }}>
      {children}
      {hideCancel ? (
        confirmButton
      ) : (
        <div className="modal-actions">
          <button type="button" className="modal-cancel-button" disabled={busy} onClick={onCancel}>{cancelLabel ?? t("ui.cancel")}</button>
          {confirmButton}
        </div>
      )}
    </AlertModal>
  );
}
