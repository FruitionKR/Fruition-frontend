"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { PERMISSION_OPTIONS, describePermissionError } from "@/entities/document/lib/documentAccess";
import type { DocumentPermission } from "@/entities/document/model/document";
import { useBackdropClick } from "@/shared/lib/useBackdropClick";
import { useEscapeKey } from "@/shared/lib/useEscapeKey";
import styles from "./DocumentSidebar.module.css";

/** 권한 설정 대상. 폴더 권한은 트리 응답에 없어 현재값을 모르므로 null(상위 따름)에서 시작한다. */
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
      setErrorMessage(describePermissionError(error));
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
        <h2 id="permission-dialog-title">{isFolder ? "폴더 권한 설정" : "문서 권한 설정"}</h2>
        <p>
          「{target.label}」{isFolder ? " 폴더 안의 문서와 하위 폴더가 이 설정을 따릅니다. OWNER만 바꿀 수 있습니다." : " 문서를 다른 멤버가 편집할 수 있는지 정합니다. 문서 소유자와 OWNER는 설정과 관계없이 항상 편집할 수 있습니다."}
        </p>
        <fieldset className={styles["permission-options"]} disabled={isSaving}>
          <legend className={styles["visually-hidden"]}>권한</legend>
          {PERMISSION_OPTIONS.map((option) => (
            <label key={option.value ?? "inherit"} className={styles["permission-option"]}>
              <input
                type="radio"
                name="document-permission"
                value={option.value ?? ""}
                checked={access === option.value}
                onChange={() => setAccess(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {errorMessage && <p className={styles["permission-error"]} role="alert">{errorMessage}</p>}
        <div className="modal-actions">
          <button type="button" className="modal-cancel-button" disabled={isSaving} onClick={onClose}>취소</button>
          <button type="button" className="modal-confirm-button" disabled={isSaving || access === target.permission} onClick={() => void save()}>
            {isSaving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
