"use client";

import { ConfirmModal } from "./ConfirmModal";

/** 문서 위에 문서를 놓아 새 묶음 폴더를 만들기 전 확인 모달 (ConfirmModal 재사용) */
export function MergeConfirmModal({
  target,
  onConfirm,
  onCancel
}: {
  target: { sourceLabel: string; targetLabel: string };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmModal
      titleId="merge-confirm-title"
      title="새 폴더로 묶으시겠습니까?"
      description={
        <>
          「{target.sourceLabel}」와 「{target.targetLabel}」를 담는 새 폴더 「새 문서 묶음」이 만들어집니다. 폴더 이름은 나중에 바꿀 수 있습니다.
        </>
      }
      confirmLabel="폴더 만들기"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
