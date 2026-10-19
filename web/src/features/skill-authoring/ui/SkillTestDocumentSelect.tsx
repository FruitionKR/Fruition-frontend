"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useDismissableMenu } from "@/shared/hooks/useDismissableMenu";
import { cx } from "@/shared/lib/classNames";
import { SvgIcon } from "@/shared/ui/SvgIcon";
import selectArrowIcon from "@/shared/assets/svg/common/select-arrow.svg";
import selectCheckIcon from "@/shared/assets/svg/common/select-check.svg";
import styles from "./SkillTestRunCard.module.css";

/**
 * 테스트할 문서 선택 상자 (Figma 1610:9350). 닫힌 상자(테두리 라벨 + 화살표) 아래에 문서 목록을 펼치고,
 * 고른 문서에는 오른쪽에 체크를 보인다. 네이티브 select 목록 대신 Figma 목록을 그리기 위한 listbox다.
 */
export function SkillTestDocumentSelect({
  id,
  value,
  placeholder,
  options,
  onChange
}: {
  id: string;
  value: string;
  placeholder: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useDismissableMenu<HTMLDivElement>(isOpen, close);
  const selected = options.find((option) => option.value === value);

  function close() {
    const hadFocus = listRef.current?.contains(document.activeElement) ?? false;
    setIsOpen(false);
    if (hadFocus) triggerRef.current?.focus();
  }

  function choose(nextValue: string) {
    onChange(nextValue);
    close();
  }

  // 펼치면 고른 문서(없으면 첫 문서)에 포커스를 둔다.
  useEffect(() => {
    if (!isOpen) return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
    (buttons.find((button) => button.getAttribute("aria-selected") === "true") ?? buttons[0])?.focus();
  }, [isOpen]);

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div ref={wrapRef} className={styles["doc-select"]}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={styles["doc-select-trigger"]}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        disabled={options.length === 0}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className={cx(styles["doc-select-label"], !selected && styles["is-placeholder"])}>
          {selected?.label ?? placeholder}
        </span>
        <SvgIcon src={selectArrowIcon} className={styles["doc-select-arrow"]} />
      </button>
      {isOpen && (
        <div ref={listRef} id={listId} role="listbox" aria-labelledby={id} className={styles["doc-select-list"]} onKeyDown={handleListKeyDown}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={styles["doc-select-option"]}
                onClick={() => choose(option.value)}
              >
                <span className={styles["doc-select-label"]}>{option.label}</span>
                <SvgIcon src={selectCheckIcon} className={styles["doc-select-check"]} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
