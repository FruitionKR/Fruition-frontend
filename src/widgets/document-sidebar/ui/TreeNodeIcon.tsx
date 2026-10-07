import type { TreeItem } from "@/entities/tree";
import { isFileItem } from "@/entities/tree";
import {
  arrowIcon,
  fileIcon,
  sourceIcon,
  SvgIcon
} from "@/shared/ui/SvgIcon";
import { cx } from "@/shared/lib/classNames";
import styles from "./DocumentSidebar.module.css";

export function TreeNodeIcon({
  item,
  isExpandable,
  isOpen
}: {
  item: TreeItem;
  isExpandable: boolean;
  isOpen: boolean;
}) {
  if (isFileItem(item)) {
    if (item.status === "uploading") return <span className={styles["tree-upload-spinner"]} aria-hidden />;
    return <span className={styles["tree-folder-slot"]} aria-hidden />;
  }
  if (item.wikiKind === "source") return <SvgIcon src={sourceIcon} className={cx(styles["tree-asset"], styles.source)} />;
  if (item.wikiKind === "concept") return <SvgIcon src={fileIcon} className={cx(styles["tree-asset"], styles.concept)} />;
  return (
    <span className={styles["tree-folder-slot"]} aria-hidden>
      {isExpandable && <SvgIcon src={arrowIcon} className={cx(styles["tree-arrow"], isOpen && styles["is-open"])} />}
    </span>
  );
}
