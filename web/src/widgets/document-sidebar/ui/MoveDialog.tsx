"use client";

import { createPortal } from "react-dom";
import { useBackdropClick } from "@/shared/hooks/useBackdropClick";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import type { MoveDestination } from "@/widgets/workspace/lib/treeMoveRules";
import styles from "./DocumentSidebar.module.css";

/** 트리 들여쓰기 한 단계(px). 좁은 시트에서도 경로가 보이도록 트리 행보다 얕게 준다. */
const MOVE_DESTINATION_INDENT_PX = 16;

/** 끌어다 놓기를 쓸 수 없는 터치 기기에서 항목을 옮길 폴더를 고른다. */
export function MoveDialog({
  label,
  destinations,
  onSelect,
  onClose
}: {
  /** 옮길 대상 이름 또는 "N개 항목" */
  label: string;
  destinations: MoveDestination[];
  onSelect: (folderId: string | null) => void;
  onClose: () => void;
}) {
  useEscapeKey(true, onClose);
  const backdropClick = useBackdropClick(onClose);

  return createPortal(
    <div className="modal-backdrop" role="presentation" {...backdropClick}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="move-dialog-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="move-dialog-title">{label} 이동</h2>
        <p>옮길 폴더를 고르세요.</p>
        <ul className={styles["move-destinations"]}>
          {destinations.map((destination) => (
            <li key={destination.folderId ?? "root"}>
              <button
                type="button"
                style={{ paddingLeft: 12 + destination.depth * MOVE_DESTINATION_INDENT_PX }}
                onClick={() => onSelect(destination.folderId)}
              >
                {destination.label}
              </button>
            </li>
          ))}
        </ul>
        {destinations.length === 0 && <p>옮길 수 있는 폴더가 없습니다.</p>}
        <div className="modal-actions">
          <button type="button" className={styles["move-cancel"]} onClick={onClose}>취소</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
