import type { DragEvent as ReactDragEvent } from "react";
import { cx } from "@/shared/lib/classNames";
import { hasDroppedFiles } from "@/entities/tree";
import type { Project } from "@/entities/tree";
import { SidebarTree } from "./SidebarTree";
import type { TreeInteractionProps } from "../model/treeInteraction";
import styles from "./DocumentSidebar.module.css";

/** 루트 문서·폴더를 한 트리로 보여준다. 빈 여백에 항목을 끌어다 놓으면 루트로 이동한다. */
export function RootTree({ project, interaction }: { project: Project; interaction: TreeInteractionProps }) {
  const { dropTarget } = interaction;
  const isRootDropTarget = dropTarget?.projectId === project.id && dropTarget.targetId === null;

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (hasDroppedFiles(event) || !interaction.draggedItemId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    interaction.onDragOverItem({ projectId: project.id, targetId: null, position: "inside" });
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (hasDroppedFiles(event) || !interaction.draggedItemId) return;
    event.preventDefault();
    interaction.onMoveItem({ projectId: project.id, targetId: null, position: "inside" });
  }

  return (
    <div
      role="tree"
      aria-label="문서 트리"
      // 스킬 대상 고르기에서는 한 항목만 고른다.
      aria-multiselectable={!interaction.isPickingTarget}
      className={cx(styles["tree-root"], isRootDropTarget && styles["is-tree-drop-target"])}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {project.items.length > 0
        ? <SidebarTree items={project.items} projectId={project.id} interaction={interaction} />
        : <p className={styles["tree-root-empty"]}>아직 문서가 없습니다</p>}
    </div>
  );
}
