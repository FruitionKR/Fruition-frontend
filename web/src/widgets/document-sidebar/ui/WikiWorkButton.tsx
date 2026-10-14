import { useRef, useState } from "react";
import type { DocumentItemResponse } from "@/entities/document/model/document";
import { useActiveLintOperation } from "@/features/wiki-ingest/model/useActiveLintOperation";
import { useActiveRestoreOperations } from "@/features/wiki-ingest/model/useActiveRestoreOperations";
import { selectActiveIngestDocuments } from "@/features/wiki-ingest/model/wikiReflectState";
import { buildWikiWorkSections } from "@/features/wiki-ingest/model/wikiWorkList";
import { useDismissOnOutside } from "@/shared/hooks/useDismissOnOutside";
import { RailButton } from "@/widgets/rail-navigation/ui/RailNavigation";
import { RailWorkIcon } from "@/widgets/rail-navigation/ui/RailIcons";
import { WikiWorkPopover } from "./WikiWorkPopover";
import styles from "./DocumentSidebar.module.css";

/** 레일의 진행 중 작업 버튼 (Figma 1436:17585). 누르면 오른쪽에 진행 중 작업 팝오버를 연다. */
export function WikiWorkButton({ documents = [] }: { documents?: DocumentItemResponse[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 팝오버와 같은 쿼리를 공유해 말풍선에 진행 중 개수를 붙인다(진행 중일 때만 폴링).
  const activeLint = useActiveLintOperation(false);
  const activeRestores = useActiveRestoreOperations();
  const workCount = buildWikiWorkSections(selectActiveIngestDocuments(documents), activeLint, activeRestores)
    .reduce((count, section) => count + section.rows.length, 0);

  useDismissOnOutside(rootRef, isOpen, () => setIsOpen(false));

  return (
    <div className={styles["rail-popover-anchor"]} ref={rootRef}>
      <RailButton
        label="진행 중인 작업"
        tooltip={workCount > 0 ? `진행 중인 작업 ${workCount}건` : "진행 중인 작업"}
        aria-expanded={isOpen}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((open) => !open);
        }}
      >
        <RailWorkIcon />
      </RailButton>
      {isOpen && <WikiWorkPopover documents={documents} />}
    </div>
  );
}
