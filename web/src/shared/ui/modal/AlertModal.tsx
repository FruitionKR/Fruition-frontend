"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "@/shared/hooks/useModalFocus";
import { useBackdropClick } from "@/shared/hooks/useBackdropClick";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";

/** 경고 아이콘 + 제목 + 설명 + 액션 버튼으로 구성된 공통 알림 모달 (Figma 512:10792 패턴) */
export function AlertModal({
  titleId,
  title,
  description,
  onClose,
  children
}: {
  titleId: string;
  title: string;
  description: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEscapeKey(true, onClose);
  const backdropClick = useBackdropClick(onClose);

  const cardRef = useRef<HTMLDivElement>(null);
  useModalFocus(cardRef);
  useEffect(() => { cardRef.current?.focus(); }, []);

  return createPortal(
    <div className="modal-backdrop" role="presentation" {...backdropClick}>
      <div
        ref={cardRef}
        tabIndex={-1}
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-describedby={`${titleId}-description`}
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <svg className="modal-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2.5 23 21H1L12 2.5Zm0 6.1c-.6 0-1 .4-1 1v4.2c0 .6.4 1 1 1s1-.4 1-1V9.6c0-.6-.4-1-1-1Zm0 8.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z" />
        </svg>
        <h2 id={titleId}>{title}</h2>
        <div className="modal-description" id={`${titleId}-description`}>{description}</div>
        {children}
      </div>
    </div>,
    document.body
  );
}
