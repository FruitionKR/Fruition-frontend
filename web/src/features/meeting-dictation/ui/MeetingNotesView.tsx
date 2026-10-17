import { useLayoutEffect, useRef, useState } from "react";
import { AgentChevronIcon } from "@/features/agent-chat/ui/AgentIcons";
import { cx } from "@/shared/lib/classNames";
import { transcriptLines } from "../lib/liveTranscript";
import { canDeleteMeetingInPhase, MEETING_TITLES, meetingProgressText } from "../lib/meetingNotesFlow";
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
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const isStuckToBottomRef = useRef(true);
  const { phase, notes, preview, transcript, notice } = session;

  const showsNotes = (phase === "ready" || phase === "saving" || phase === "applied") && Boolean(notes?.markdown);
  const body = phase === "previewing" && preview
    ? preview.markdown
    : showsNotes ? notes?.markdown ?? "" : transcriptLines(transcript).join("\n");

  // 카드는 아래 정렬이다. 사용자가 위로 올려 읽는 중이 아니면 새 내용이 보이게 맨 아래로 맞춘다.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (card && isStuckToBottomRef.current) card.scrollTop = card.scrollHeight;
  }, [body, isCollapsed]);

  if (phase === "idle") return null;
  const progressText = meetingProgressText(phase, session.uploadPercent);
  const meeting = session.meeting;
  const canDelete = Boolean(meeting) && canDeleteMeetingInPhase(phase);
  const showsPlayer = Boolean(meeting?.has_recording) && phase !== "uploading" && phase !== "deleting";
  const emptyText = session.source === "upload"
    ? "녹음 파일을 전사하면 받아쓴 내용이 여기에 보여요."
    : "말씀을 시작하면 받아쓴 문장이 여기에 쌓여요.";
  const title = MEETING_TITLES[phase];
  const canAppend = Boolean(session.meeting?.document_id);

  return (
    <section className={styles["meeting-view"]} aria-label="회의 받아쓰기">
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
          {/* 시안에 없는 동작이라 제목 줄 오른쪽에 글자 버튼으로 둔다. 받아쓰는 중·저장 중에는 닫을 수 없다. */}
          {(canDelete || phase === "stopped" || phase === "ready" || phase === "applied") && (
            <div className={styles["meeting-title-actions"]}>
              {canDelete && (
                <button type="button" className={cx(styles["meeting-close"], styles["is-danger"])} onClick={() => setIsConfirmingDelete(true)}>
                  삭제
                </button>
              )}
              <button type="button" className={styles["meeting-close"]} onClick={session.close}>닫기</button>
            </div>
          )}
        </div>
        {showsPlayer && meeting && <MeetingRecordingPlayer key={meeting.meeting_id} meetingId={meeting.meeting_id} />}
        {!isCollapsed && (
          <div
            ref={cardRef}
            className={styles["meeting-card"]}
            tabIndex={0}
            aria-label={showsNotes ? "회의록" : phase === "previewing" ? "문서 끝에 추가한 결과" : "받아쓴 내용"}
            aria-live={phase === "recording" ? "polite" : undefined}
            onScroll={(event) => {
              const card = event.currentTarget;
              isStuckToBottomRef.current = card.scrollHeight - card.scrollTop - card.clientHeight <= STICK_TO_BOTTOM_PX;
            }}
          >
            {body
              ? <p className={styles["meeting-card-text"]}>{body}</p>
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
  const { phase } = session;
  if (phase === "uploading") {
    return (
      <div className={styles["meeting-actions"]}>
        <button type="button" onClick={session.cancelUpload}>올리기 취소</button>
      </div>
    );
  }
  if (phase === "transcribing") {
    return (
      <div className={styles["meeting-actions"]}>
        <button type="button" onClick={() => void session.cancelTranscription()}>전사 취소</button>
      </div>
    );
  }
  if (phase === "generating") {
    return (
      <div className={styles["meeting-actions"]}>
        <button type="button" onClick={() => void session.cancelNotes()}>회의록 만들기 취소</button>
      </div>
    );
  }
  if (phase === "stopped") {
    const canReupload = session.source === "upload" && session.canUploadRecording && onPickRecording;
    return (
      <div className={styles["meeting-actions"]}>
        {canReupload && (
          <button type="button" className={cx(!session.hasTranscript && styles["is-primary"])} onClick={onPickRecording}>
            {session.meeting ? "녹음 파일 다시 올리기" : "녹음 파일 고르기"}
          </button>
        )}
        {session.hasTranscript && (session.canRequestPartial ? (
          <button type="button" className={styles["is-primary"]} onClick={() => session.regenerate(true)}>저장된 내용으로 회의록 만들기</button>
        ) : (
          <button type="button" className={styles["is-primary"]} onClick={() => session.regenerate()}>회의록 만들기</button>
        ))}
      </div>
    );
  }
  if (phase === "ready" || phase === "saving") {
    const isSaving = phase === "saving";
    return (
      <div className={styles["meeting-actions"]}>
        <button type="button" disabled={isSaving} onClick={() => session.regenerate()}>다시 만들기</button>
        {canAppend && (
          <button type="button" disabled={isSaving} onClick={() => void session.previewAppend()}>문서 끝에 추가</button>
        )}
        <button type="button" className={styles["is-primary"]} disabled={isSaving} onClick={() => void session.saveAsNewDocument()}>
          새 문서로 저장
        </button>
      </div>
    );
  }
  if (phase === "previewing") {
    return (
      <div className={styles["meeting-actions"]}>
        <button type="button" onClick={session.cancelPreview}>취소</button>
        <button type="button" className={styles["is-primary"]} onClick={() => void session.confirmAppend()}>문서 끝에 추가</button>
      </div>
    );
  }
  return null;
}
