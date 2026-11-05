import type { Ref } from "react";
import type { MarkdownDiffLine } from "@/shared/lib/lineDiff";
import styles from "./DocumentDiffLines.module.css";

const DIFF_MARKERS = {
  context: " ",
  delete: "−",
  insert: "+"
} as const;

export type DocumentDiffGroup = { key: string; heading?: string; lines: readonly MarkdownDiffLine[] };

/**
 * 줄 단위 diff. 본문은 Markdown으로 해석하지 않고 글자 그대로 보여 준다.
 * 안쪽에서 스크롤하므로 키보드로도 굴릴 수 있게 포커스를 받는다.
 */
export function DocumentDiffLines({ label, groups, regionRef }: { label: string; groups: readonly DocumentDiffGroup[]; regionRef?: Ref<HTMLDivElement> }) {
  return (
    <div ref={regionRef} className={styles["markdown-edit-diff"]} role="group" aria-label={label} tabIndex={0}>
      {groups.map((group) => (
        <div key={group.key}>
          {group.heading && <p className={styles["diff-group-heading"]}>{group.heading}</p>}
          {group.lines.map((line, index) => (
            <code className={styles[`is-${line.type}`]} key={`${line.type}-${index}`}>
              <span aria-hidden="true">{DIFF_MARKERS[line.type]}</span>
              {line.text || " "}
            </code>
          ))}
        </div>
      ))}
    </div>
  );
}
