import styles from "./AgentChat.module.css";

/** "찾은 자료" 한 건 (Figma 1436:17303): 밑줄 친 제목 링크. 미리보기를 열 수 없는 자료는 텍스트로만 보인다. */
export function AgentResultCard({
  title,
  meta,
  onClick
}: {
  title: string;
  meta: string;
  onClick?: () => void;
}) {
  // 시안은 제목만 보여 주므로 보조 정보(meta)는 툴팁으로 남긴다.
  return onClick ? (
    <button className={styles["result-link"]} type="button" title={meta} onClick={(event) => { event.stopPropagation(); onClick(); }}>
      {title}
    </button>
  ) : <span className={styles["result-link"]} title={meta}>{title}</span>;
}
