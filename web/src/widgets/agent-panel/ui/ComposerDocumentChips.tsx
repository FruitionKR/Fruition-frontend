import type { RefObject } from "react";
import type { DocumentItemResponse } from "@/entities/document";
import contextChipCloseIcon from "@/shared/assets/svg/agent/context-chip-close.svg";
import { AgentAssetIcon } from "@/features/agent-chat/ui/AgentIcons";
import { documentDisplayName } from "@/features/skill-authoring/lib/referenceDocumentPicker";
import { cx } from "@/shared/lib/classNames";
import { composerDocumentChipLabel } from "../lib/composerDocuments";
import styles from "@/features/agent-chat/ui/AgentChat.module.css";

/** 첨부한 문서 칩과 "+ 문서 추가". 3개를 다 고르면 버튼을 막고 이유를 옆에 보여 준다. */
export function ComposerDocumentChips({
  attachments,
  canAdd,
  isDisabled,
  limitMessage,
  addButtonRef,
  onRemove,
  onAdd
}: {
  attachments: readonly DocumentItemResponse[];
  canAdd: boolean;
  /** 입력창을 쓸 수 없는 동안(보내는 중 등)이다. 보내는 동안 고른 첨부가 되돌린 첨부와 섞이지 않게 막는다. */
  isDisabled: boolean;
  limitMessage: string | null;
  addButtonRef: RefObject<HTMLButtonElement | null>;
  onRemove: (documentId: string) => void;
  onAdd: () => void;
}) {
  return (
    <>
      {attachments.map((document) => {
        const title = documentDisplayName(document);
        return (
          <button
            key={document.id}
            type="button"
            className={cx(styles["task-context-chip"], styles["is-document"])}
            aria-label={`${title} 첨부 빼기`}
            title={title}
            onClick={() => onRemove(document.id)}
          >
            <span className={styles["task-context-chip-label"]}>{composerDocumentChipLabel(document)}</span>
            <AgentAssetIcon src={contextChipCloseIcon} size={12} />
          </button>
        );
      })}
      <button
        ref={addButtonRef}
        type="button"
        className={styles["task-context-chip-add"]}
        aria-haspopup="dialog"
        disabled={!canAdd || isDisabled}
        title={limitMessage ?? undefined}
        onClick={onAdd}
      >
        + 문서 추가
      </button>
      {limitMessage && <span className={styles["task-context-limit"]} role="status">{limitMessage}</span>}
    </>
  );
}
