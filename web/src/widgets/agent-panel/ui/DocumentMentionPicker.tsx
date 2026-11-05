import { useEffect, useRef } from "react";
import type { DocumentItemResponse } from "@/entities/document";
import { documentDisplayName } from "@/features/skill-authoring/lib/referenceDocumentPicker";
import { cx } from "@/shared/lib/classNames";
import styles from "@/features/agent-chat/ui/AgentChat.module.css";

export const DOCUMENT_PICKER_LIST_ID = "agent-document-picker";

export function documentPickerOptionId(documentId: string) {
  return `agent-document-option-${documentId}`;
}

/** 작업 입력창에 "@"를 치면 뜨는 문서 고르기. 스킬 고르기(SkillSlashPicker)와 같은 카드를 쓴다. Figma 시안이 없어 그 스타일을 따른다. */
export function DocumentMentionPicker({
  options,
  activeOptionId,
  openDocumentId,
  statusMessage,
  onPick,
  onHover
}: {
  options: DocumentItemResponse[];
  activeOptionId: string | null;
  openDocumentId: string | null;
  /** 항목이 없을 때의 안내 */
  statusMessage: string;
  onPick: (document: DocumentItemResponse) => void;
  onHover: (documentId: string) => void;
}) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeOptionId]);

  return (
    <div className={styles["skill-picker"]}>
      {options.length > 0 ? (
        <div className={cx(styles["skill-picker-groups"], styles["document-picker-list"])} role="listbox" id={DOCUMENT_PICKER_LIST_ID} aria-label="첨부할 문서">
          {options.map((document) => {
            const isActive = document.id === activeOptionId;
            const title = documentDisplayName(document);
            return (
              <div
                key={document.id}
                ref={isActive ? activeRef : undefined}
                id={documentPickerOptionId(document.id)}
                role="option"
                aria-selected={isActive}
                title={title}
                className={cx(styles["skill-picker-option"], styles["document-picker-option"], isActive && styles["is-active"])}
                // 입력창 포커스를 지킨 채 고른다.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHover(document.id)}
                onClick={() => onPick(document)}
              >
                <span className={cx(styles["skill-picker-slug"], styles["document-picker-title"])}>{title}</span>
                {document.id === openDocumentId && <span className={styles["skill-picker-description"]}>현재 문서</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <p className={styles["skill-picker-empty"]} role="status">{statusMessage}</p>
      )}
    </div>
  );
}
