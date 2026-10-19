"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useDismissableMenu } from "@/shared/hooks/useDismissableMenu";
import { cx } from "@/shared/lib/classNames";
import { SvgIcon } from "@/shared/ui/SvgIcon";
import selectArrowIcon from "@/shared/assets/svg/common/select-arrow.svg";
import selectCheckIcon from "@/shared/assets/svg/common/select-check.svg";
import selectPlusIcon from "@/shared/assets/svg/common/select-plus.svg";
import styles from "./OptionSelect.module.css";

/**
 * 문서 고르기 드롭다운 (Figma 1610:9350). 닫힌 상자(테두리 라벨 + 화살표) 아래에 목록을 펼치고,
 * 고른 항목 오른쪽에 체크를 보인다. action은 목록 끝의 "+ 새 문서로 만들기" 같은 보조 동작이다.
 * floating이면 목록을 아래 내용 위에 띄운다(표 행·모달처럼 높이가 밀리면 안 되는 자리). ariaLabel·title은 보이는 라벨이 없을 때 쓴다.
 */
export function OptionSelect({
  id,
  value,
  placeholder,
  options,
  action,
  disabled,
  floating,
  ariaLabel,
  title,
  onChange
}: {
  id?: string;
  value: string | null;
  placeholder: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  action?: { label: string; disabled?: boolean; onSelect: () => void };
  disabled?: boolean;
  floating?: boolean;
  ariaLabel?: string;
  title?: string;
  onChange: (value: string) => void;
}) {
  const fallbackId = useId();
  const triggerId = id ?? fallbackId;
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

  function listButtons() {
    return Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
  }

  // 펼치면 고른 항목(없으면 첫 항목)에 포커스를 둔다.
  useEffect(() => {
    if (!isOpen) return;
    const buttons = listButtons();
    (buttons.find((button) => button.getAttribute("aria-selected") === "true") ?? buttons[0])?.focus();
  }, [isOpen]);

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = listButtons();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div ref={wrapRef} className={styles.select}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled || (options.length === 0 && !action)}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className={cx(styles.label, !selected && styles["is-placeholder"])}>{selected?.label ?? placeholder}</span>
        <SvgIcon src={selectArrowIcon} className={styles.arrow} />
      </button>
      {isOpen && (
        <div ref={listRef} className={cx(styles.list, floating && styles["is-floating"])} onKeyDown={handleListKeyDown}>
          <div id={listId} role="listbox" aria-labelledby={triggerId} className={styles.options}>
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={styles.option}
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                >
                  <span className={styles.label}>{option.label}</span>
                  <SvgIcon src={selectCheckIcon} className={styles.check} />
                </button>
              );
            })}
          </div>
          {action && (
            <button
              type="button"
              className={styles.action}
              disabled={action.disabled}
              onClick={() => {
                action.onSelect();
                close();
              }}
            >
              <SvgIcon src={selectPlusIcon} className={styles["action-icon"]} />
              <span className={styles.label}>{action.label}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
