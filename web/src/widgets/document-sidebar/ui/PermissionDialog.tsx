"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { PERMISSION_OPTION_VALUES, isWriteForbiddenError } from "@/entities/document/lib/documentAccess";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import type { DocumentPermission } from "@/entities/document/model/document";
import { useBackdropClick } from "@/shared/hooks/useBackdropClick";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import styles from "./DocumentSidebar.module.css";

/** 권한 설정 대상. 폴더는 트리 응답의 permission을 쓰고, 백엔드가 아직 안 보내면 null(상위 따름)에서 시작한다. */
export type PermissionDialogTarget = {
  kind: "folder" | "document";
  id: string;
  label: string;
  permission: DocumentPermission | null;
};

/**
 * 문서·폴더 공동 편집 권한을 바꾸는 작은 다이얼로그 (컨텍스트 메뉴 → 권한 설정).
 * 저장은 서버가 소유자·OWNER를 판정하고, 403은 누가 바꿀 수 있는지 안내한다.
 */
export function PermissionDialog({
  target,
  onSave,
  onClose
}: {
  target: PermissionDialogTarget;
  onSave: (access: DocumentPermission | null) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("documents.permission");
  const tShared = useTranslations("shared");
  const [access, setAccess] = useState<DocumentPermission | null>(target.permission);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  useEscapeKey(!isSaving, onClose);
  const backdropClick = useBackdropClick(() => { if (!isSaving) onClose(); });
  const isFolder = target.kind === "folder";

  async function save() {
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await onSave(access);
      onClose();
    } catch (error) {
      // 403은 서버 원문 대신 누가 바꿀 수 있는지 설명한다.
      setErrorMessage(isWriteForbiddenError(error) ? t("forbidden") : getErrorMessage(error, t("saveFailed"), tShared));
      setIsSaving(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" {...backdropClick}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="permission-dialog-title">{isFolder ? t("folderTitle") : t("documentTitle")}</h2>
        <p>
          {isFolder ? t("folderDescription", { label: target.label }) : t("documentDescription", { label: target.label })}
        </p>
        <fieldset className={styles["permission-options"]} disabled={isSaving}>
          <legend className={styles["visually-hidden"]}>{t("legend")}</legend>
          {PERMISSION_OPTION_VALUES.map((value) => (
            <label key={value ?? "inherit"} className={styles["permission-option"]}>
              <input
                type="radio"
                name="document-permission"
                value={value ?? ""}
                checked={access === value}
                onChange={() => setAccess(value)}
              />
              <span>
                <strong>{t(`options.${value ?? "inherit"}.label`)}</strong>
                <small>{t(`options.${value ?? "inherit"}.description`)}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {errorMessage && <p className={styles["permission-error"]} role="alert">{errorMessage}</p>}
        <div className="modal-actions">
          <button type="button" className="modal-cancel-button" disabled={isSaving} onClick={onClose}>{t("cancel")}</button>
          <button type="button" className="modal-confirm-button" disabled={isSaving || access === target.permission} onClick={() => void save()}>
            {isSaving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
