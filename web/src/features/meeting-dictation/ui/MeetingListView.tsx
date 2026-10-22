import type { MeetingListItem } from "@/entities/meeting";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { cx } from "@/shared/lib/classNames";
import { formatRelativeTime } from "@/shared/lib/relativeTime";
import { meetingListBadge } from "../lib/meetingResume";
import { useMeetingList } from "../model/useMeetingList";
import styles from "./MeetingNotes.module.css";

/**
 * 지난 회의 목록(진행 중인 회의 이어 보기). 회의 목록 시안이 없어 회의록 화면(Figma 1540:22903)의
 * 제목 줄·테두리 카드·진행 표시·글자 버튼 패턴을 그대로 쓴다. 회의를 고르면 onOpen이 그 회의 화면을 연다.
 */
export function MeetingListView({
  onOpen,
  onClose,
  openErrorMessage
}: {
  onOpen: (item: MeetingListItem) => void;
  onClose: () => void;
  /** 고른 회의를 열지 못했을 때 문구 */
  openErrorMessage: string | null;
}) {
  const list = useMeetingList();
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className={styles["meeting-view"]} aria-label="지난 회의">
      <div className={styles["meeting-container"]}>
        <div className={styles["meeting-title-row"]}>
          <h2 className={styles["meeting-list-title"]}>지난 회의</h2>
          <div className={styles["meeting-title-actions"]}>
            <button type="button" className={styles["meeting-close"]} onClick={onClose}>닫기</button>
          </div>
        </div>
        <div className={cx(styles["meeting-card"], styles["meeting-list-card"])}>
          {items.length > 0 ? (
            <ul className={styles["meeting-list"]}>
              {items.map((item) => (
                <li key={item.meeting_id}>
                  <MeetingListRow item={item} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          ) : (
            !list.isPending && !list.isError && <p className={styles["meeting-card-empty"]}>아직 만든 회의가 없어요. 회의 녹음하기나 녹음 파일 올리기로 시작해 보세요.</p>
          )}
          {list.hasNextPage && (
            <button
              type="button"
              className={styles["meeting-list-more"]}
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? "불러오는 중…" : "더 보기"}
            </button>
          )}
        </div>
      </div>
      <div className={styles["meeting-footer"]}>
        {list.isPending && (
          <div className={styles["meeting-progress"]} role="status">
            <span aria-hidden><i /><i /><i /></span>
            <p>회의 목록을 불러오고 있어요…</p>
          </div>
        )}
        {list.isError && (
          <p className={cx(styles["meeting-notice"], styles["is-error"])} role="alert">
            {getErrorMessage(list.error, "회의 목록을 불러오지 못했습니다.")}
          </p>
        )}
        {openErrorMessage && (
          <p className={cx(styles["meeting-notice"], styles["is-error"])} role="alert">{openErrorMessage}</p>
        )}
        {list.isError && (
          <div className={styles["meeting-actions"]}>
            <button type="button" onClick={() => void list.refetch()}>다시 시도</button>
          </div>
        )}
      </div>
    </section>
  );
}

function MeetingListRow({ item, onOpen }: { item: MeetingListItem; onOpen: (item: MeetingListItem) => void }) {
  const badge = meetingListBadge(item);
  const details = [formatRelativeTime(item.created_at), item.source === "upload" ? "녹음 파일" : "실시간 녹음"];
  if (item.has_recording) details.push("녹음 있음");
  return (
    <button type="button" className={styles["meeting-list-item"]} onClick={() => onOpen(item)}>
      <span className={styles["meeting-list-text"]}>
        <span className={styles["meeting-list-name"]}>{item.display_name}</span>
        <span className={styles["meeting-list-meta"]}>
          <time dateTime={item.created_at}>{details[0]}</time>
          {details.slice(1).map((detail) => <span key={detail}> · {detail}</span>)}
        </span>
      </span>
      <span className={cx(styles["meeting-list-badge"], styles[`is-${badge.tone}`])}>{badge.label}</span>
    </button>
  );
}
