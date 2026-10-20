import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import styles from "./DocumentSidebar.module.css";

/**
 * 트리의 새 폴더·이름 변경 입력. 열리면 기본 이름 전체를 골라 바로 새 이름을 칠 수 있게 한다
 * (새 노트 제목 칸 focusNoteTitleWhenReady와 같은 동작). 기본 이름 뒤에 덧붙지 않는다.
 */
export function InlineEditInput({
  value,
  onCommit,
  onCancel,
  onChange
}: {
  value: string;
  onCommit: () => void;
  onCancel: () => void;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") onCommit();
    if (event.key === "Escape") onCancel();
  }

  return (
    <input
      className={styles["tree-edit-input"]}
      ref={inputRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    />
  );
}
