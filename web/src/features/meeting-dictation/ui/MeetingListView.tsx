import { useFormatter, useTranslations } from "next-intl";
import type { MeetingListItem } from "@/entities/meeting";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { cx } from "@/shared/lib/classNames";
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
  const t = useTranslations("meeting");
  const list = useMeetingList();
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className={styles["meeting-view"]} aria-label={t("list.title")}>
      <div className={styles["meeting-container"]}>
        <div className={styles["meeting-title-row"]}>
          <h2 className={styles["meeting-list-title"]}>{t("list.title")}</h2>
          <div className={styles["meeting-title-actions"]}>
            <button type="button" className={styles["meeting-close"]} onClick={onClose}>{t("list.close")}</button>
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
            !list.isPending && !list.isError && <p className={styles["meeting-card-empty"]}>{t("list.empty")}</p>
          )}
          {list.hasNextPage && (
            <button
              type="button"
              className={styles["meeting-list-more"]}
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? t("list.loadingMore") : t("list.more")}
            </button>
          )}
        </div>
      </div>
      <div className={styles["meeting-footer"]}>
        {list.isPending && (
          <div className={styles["meeting-progress"]} role="status">
            <span aria-hidden><i /><i /><i /></span>
            <p>{t("list.loading")}</p>
          </div>
        )}
        {list.isError && (
          <p className={cx(styles["meeting-notice"], styles["is-error"])} role="alert">
            {getErrorMessage(list.error, t("errors.listFailed"))}
          </p>
        )}
        {openErrorMessage && (
          <p className={cx(styles["meeting-notice"], styles["is-error"])} role="alert">{openErrorMessage}</p>
        )}
        {list.isError && (
          <div className={styles["meeting-actions"]}>
            <button type="button" onClick={() => void list.refetch()}>{t("list.retry")}</button>
          </div>
        )}
      </div>
    </section>
  );
}

function MeetingListRow({ item, onOpen }: { item: MeetingListItem; onOpen: (item: MeetingListItem) => void }) {
  const t = useTranslations("meeting");
  const format = useFormatter();
  const badge = meetingListBadge(item);
  const details = [format.relativeTime(new Date(item.created_at)), item.source === "upload" ? t("list.sourceUpload") : t("list.sourceLive")];
  if (item.has_recording) details.push(t("list.hasRecording"));
  return (
    <button type="button" className={styles["meeting-list-item"]} onClick={() => onOpen(item)}>
      <span className={styles["meeting-list-text"]}>
        <span className={styles["meeting-list-name"]}>{item.display_name}</span>
        <span className={styles["meeting-list-meta"]}>
          <time dateTime={item.created_at}>{details[0]}</time>
          {details.slice(1).map((detail) => <span key={detail}> · {detail}</span>)}
        </span>
      </span>
      <span className={cx(styles["meeting-list-badge"], styles[`is-${badge.tone}`])}>{t(`badges.${badge.label}`)}</span>
    </button>
  );
}
