"use client";

import { useEffect, useRef } from "react";
import modalStyles from "@/shared/ui/modal/CenteredModal.module.css";
import { plusIcon, SvgIcon } from "@/shared/ui/SvgIcon";

/** 중앙 검색 모달 머리: 열릴 때 포커스되는 검색 입력과 닫기 버튼. CenteredModal 안에서 쓴다. */
export function SearchModalHeader({
  placeholder,
  value,
  onChange,
  onClose
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className={modalStyles["modal-header"]}>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className={modalStyles["modal-close"]} aria-label="검색 닫기" onClick={onClose}>
        <SvgIcon src={plusIcon} className={modalStyles["modal-close-icon"]} />
      </button>
    </div>
  );
}
