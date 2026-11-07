import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AgentChevronIcon } from "@/features/agent-chat/ui/AgentIcons";
import { cx } from "@/shared/lib/classNames";
import { transcriptLines } from "../lib/liveTranscript";
import { meetingCardLines } from "../lib/meetingCardLines";
import { canCloseMeetingInPhase, canDeleteMeetingInPhase, meetingProgressText, meetingTitle } from "../lib/meetingNotesFlow";
import type { MeetingSessionState } from "../model/useMeetingSession";
import { MeetingDeleteConfirm } from "./MeetingDeleteConfirm";
import { MeetingRecordingPlayer } from "./MeetingRecordingPlayer";
import styles from "./MeetingNotes.module.css";

// 맨 아래에서 이만큼 안쪽이면 새 문장이 올 때 따라 내려간다.
const STICK_TO_BOTTOM_PX = 24;

/**
 * 채팅 패널 회의록 화면(Figma 1540:22903): "받아쓰는 중 ⌄" 제목, 테두리 카드에 아래 정렬로 쌓이는 전사·회의록 Markdown,
 * 카드 아래 진행 표시(● ● ● 답변을 작성하고 있어요…). 녹음 시작·멈춤은 입력창 파형 버튼이 한다.
 * 녹음 파일 전사·녹음 재생·회의 삭제는 시안이 없어 같은 화면의 글자 버튼·진행 표시 패턴을 따른다.
 * onPickRecording은 녹음 파일 선택 창을 연다(실패한 녹음 파일 회의에 다시 올리기).
 */
export function MeetingNotesView({ session, onPickRecording }: { session: MeetingSessionState; onPickRecording?: () => void }) {
  const t = useTranslations("meeting");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const isStuckToBottomRef = useRef(true);
  const { phase, notes, preview, transcript, notice } = session;

  const showsNotes = (phase === "ready" || phase === "saving" || phase === "applied") && Boolean(notes?.markdown);
  const body = phase === "previewing" && preview
    ? preview.markdown
    : showsNotes ? notes?.markdown ?? "" : transcriptLines(transcript).join("\n");

  // 완성된 회의록·추가 결과는 위에서부터 읽으므로 위 정렬한다. 받아쓰는 동안만 아래 정렬로 새 문장을 쌓는다.
  const isTopAligned = showsNotes || (phase === "previewing" && Boolean(preview));

  // 받아쓰는 동안 사용자가 위로 올려 읽는 중이 아니면 새 내용이 보이게 맨 아래로 맞춘다. 위 정렬 내용은 처음부터 보인다.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (isTopAligned) card.scrollTop = 0;
    else if (isStuckToBottomRef.current) card.scrollTop = card.scrollHeight;
  }, [body, isCollapsed, isTopAligned]);

  if (phase === "idle") return null;
  const progressText = meetingProgressText(phase, t, session.uploadPercent);
  const meeting = session.meeting;
  const canDelete = Boolean(meeting) && canDeleteMeetingInPhase(phase);
  const canClose = canCloseMeetingInPhase(phase);
  const showsPlayer = Boolean(meeting?.has_recording) && phase !== "uploading" && phase !== "deleting";
  // 회의를 불러오는 중에는 진행 표시만 보여 준다.
  const emptyText = phase === "opening" ? "" : session.source === "upload"
    ? t("view.emptyUpload")
    : t("view.emptyLive");
  const title = meetingTitle(phase, t);
  const canAppend = Boolean(session.meeting?.document_id);

  return (
    <section className={styles["meeting-view"]} aria-label={t("view.ariaLabel")}>
      <div className={cx(styles["meeting-container"], isCollapsed && styles["is-collapsed"])}>
        <div className={styles["meeting-title-row"]}>
          <button
            type="button"
            className={styles["meeting-title"]}
            aria-expanded={!isCollapsed}
            onClick={() => setIsCollapsed((collapsed) => !collapsed)}
          >
            <span>{title}</span>
            <AgentChevronIcon className={cx(styles["meeting-title-chevron"], isCollapsed && styles["is-collapsed"])} />
          </button>
          {/* 시안에 없는 동작이라 제목 줄 오른쪽에 글자 버튼으로 둔다. 받아쓰는 중·올리는 중·저장 중에는 닫을 수 없다.
              전사·회의록 생성 중에는 닫아도 서버에서 이어지고, 회의 목록에서 다시 열 수 있다. */}
          {(canDelete || canClose) && (
            <div className={styles["meeting-title-actions"]}>
              {canDelete && (
                <button type="button" className={cx(styles["meeting-close"], styles["is-danger"])} onClick={() => setIsConfirmingDelete(true)}>
                  {t("view.delete")}
                </button>
              )}
              {canClose && <button type="button" className={styles["meeting-close"]} onClick={session.close}>{t("view.close")}</button>}
            </div>
          )}
        </div>
        {showsPlayer && meeting && <MeetingRecordingPlayer key={meeting.meeting_id} meetingId={meeting.meeting_id} />}
        {!isCollapsed && (
          <div
            ref={cardRef}
            className={styles["meeting-card"]}
            tabIndex={0}
            aria-label={showsNotes ? t("view.notesLabel") : phase === "previewing" ? t("view.previewLabel") : t("view.transcriptLabel")}
            aria-live={phase === "recording" ? "polite" : undefined}
            onScroll={(event) => {
              const card = event.currentTarget;
              isStuckToBottomRef.current = card.scrollHeight - card.scrollTop - card.clientHeight <= STICK_TO_BOTTOM_PX;
            }}
          >
            {body
              ? (
                <p className={cx(styles["meeting-card-text"], isTopAligned && styles["is-top-aligned"])}>
                  {meetingCardLines(body).map((line, index) => (
                    <span
                      key={index}
                      className={styles["meeting-card-line"]}
                      style={{ paddingLeft: `${line.indent + line.hanging}ch`, textIndent: `${-line.hanging}ch` }}
                    >
                      {line.text}
                    </span>
                  ))}
                </p>
              )
              : <p className={styles["meeting-card-empty"]}>{emptyText}</p>}
          </div>
        )}
      </div>
      <div className={styles["meeting-footer"]}>
        {progressText && (
          <div className={styles["meeting-progress"]} role="status">
            <span aria-hidden><i /><i /><i /></span>
            <p>{progressText}</p>
          </div>
        )}
        {notice && (
          <p className={cx(styles["meeting-notice"], notice.tone === "error" && styles["is-error"])} role={notice.tone === "error" ? "alert" : "status"}>
            {notice.text}
          </p>
        )}
        <MeetingActions session={session} canAppend={canAppend} onPickRecording={onPickRecording} />
      </div>
      {isConfirmingDelete && meeting && (
        <MeetingDeleteConfirm
          meetingName={meeting.display_name}
          hasRecording={Boolean(meeting.has_recording)}
          onCancel={() => setIsConfirmingDelete(false)}
          onConfirm={() => {
            setIsConfirmingDelete(false);
            void session.deleteMeeting();
          }}
        />
      )}
    </section>
  );
}

function MeetingActions({
  session,
  canAppend,
  onPickRecording
}: {
  session: MeetingSessionState;
  canAppend: boolean;
  onPickRecording?: () => void;
}) {
  const t = useTranslations("meeting");
  const { phase } = session;
  if (phase === "uploading") {
    return (
      <div className={styles["meeting-actions"]}>
        <button type="button" onClick={session.cancelUpload}>{t("actions.cancelUpload")}</button>
      </div>
    );
  }
  if (phase === "transcribing") {
    return (
      <div className={styles["meeting-actions"]}>
        <button type="button" onClick={() => void session.cancelTranscription()}>{t("actions.cancelTranscription")}</button>
      </div>
    );
  }
  if (phase === "generating") {
    return (
      <div className={styles["meeting-actions"]}>
        <button type="button" onClick={() => void session.cancelNotes()}>{t("actions.cancelNotes")}</button>
      </div>
    );
  }
  if (phase === "stopped") {
    const canReupload = session.source === "upload" && session.canUploadRecording && onPickRecording;
    return (
      <div className={styles["meeting-actions"]}>
        {canReupload && (
          <button type="button" className={cx(!session.hasTranscript && styles["is-primary"])} onClick={onPickRecording}>
            {session.meeting ? t("actions.reuploadRecording") : t("actions.pickRecording")}
          </button>
        )}
        {session.hasTranscript && (session.canRequestPartial ? (
          <button type="button" className={styles["is-primary"]} onClick={() => session.regenerate(true)}>{t("actions.generatePartial")}</button>
        ) : (
          <button type="button" className={styles["is-primary"]} onClick={() => session.regenerate()}>{t("actions.generate")}</button>
        ))}
      </div>
    );
  }
  if (phase === "ready" || phase === "saving") {
    const isSaving = phase === "saving";
    return (
      <div className={styles["meeting-actions"]}>
        <button type="button" disabled={isSaving} onClick={() => session.regenerate()}>{t("actions.regenerate")}</button>
        {canAppend && (
          <button type="button" disabled={isSaving} onClick={() => void session.previewAppend()}>{t("actions.append")}</button>
        )}
        <button type="button" className={styles["is-primary"]} disabled={isSaving} onClick={() => void session.saveAsNewDocument()}>
          {t("actions.saveAsNew")}
        </button>
      </div>
    );
  }
  if (phase === "previewing") {
    return (
      <div className={styles["meeting-actions"]}>
        <button type="button" onClick={session.cancelPreview}>{t("actions.cancel")}</button>
        <button type="button" className={styles["is-primary"]} onClick={() => void session.confirmAppend()}>{t("actions.append")}</button>
      </div>
    );
  }
  return null;
}
