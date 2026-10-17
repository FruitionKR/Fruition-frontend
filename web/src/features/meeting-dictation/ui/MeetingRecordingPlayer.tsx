import { useCallback, useRef, useState } from "react";
import { fetchMeetingRecordingUrl, MEETING_ERROR_MESSAGES } from "@/entities/meeting";
import { describeRecordingError } from "../lib/meetingNotesFlow";
import styles from "./MeetingNotes.module.css";

// 서명 주소는 5분짜리다. 만료 직전에 재생을 시작하면 중간에 끊기지 않도록 이만큼 여유를 두고 새로 받는다.
const URL_EXPIRY_MARGIN_MS = 15_000;
// 재생 오류(만료 등)마다 주소를 다시 받는 횟수. 주소를 새로 받아도 계속 실패하면 멈추고 안내한다.
const MAX_URL_REFRESHES = 2;

type RecordingSource = { url: string; expiresAt: number };

/**
 * 회의 녹음 원본 재생(시안 없음). 처음에는 버튼만 두고, 누르면 recording-url로 서명 주소를 받아 <audio>로 재생한다.
 * 주소가 만료됐으면(재생 시작 시 만료 임박, 또는 재생 오류) 새 주소를 받아 같은 위치부터 이어 간다.
 */
export function MeetingRecordingPlayer({ meetingId }: { meetingId: string }) {
  const [source, setSource] = useState<RecordingSource | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 새 주소를 받은 뒤 이어서 재생할 위치
  const resumeRef = useRef<{ time: number; play: boolean } | null>(null);
  const refreshCountRef = useRef(0);

  const loadUrl = useCallback(async (resume: { time: number; play: boolean }) => {
    resumeRef.current = resume;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchMeetingRecordingUrl(meetingId);
      setSource({ url: response.url, expiresAt: Date.parse(response.expires_at) });
    } catch (loadError) {
      resumeRef.current = null;
      setError(describeRecordingError(loadError, MEETING_ERROR_MESSAGES.recordingUrlFailed));
    } finally {
      setIsLoading(false);
    }
  }, [meetingId]);

  if (!source) {
    return (
      <div className={styles["meeting-recording"]}>
        <button type="button" className={styles["meeting-recording-load"]} disabled={isLoading} onClick={() => void loadUrl({ time: 0, play: true })}>
          {isLoading ? "녹음 불러오는 중…" : "녹음 듣기"}
        </button>
        {error && <p className={styles["meeting-recording-error"]} role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className={styles["meeting-recording"]}>
      <audio
        ref={audioRef}
        className={styles["meeting-recording-audio"]}
        src={source.url}
        controls
        preload="metadata"
        aria-label="회의 녹음"
        onLoadedMetadata={(event) => {
          const resume = resumeRef.current;
          resumeRef.current = null;
          if (!resume) return;
          const audio = event.currentTarget;
          if (resume.time > 0) audio.currentTime = resume.time;
          if (resume.play) void audio.play().catch(() => undefined);
        }}
        onPlaying={() => {
          refreshCountRef.current = 0;
        }}
        onPlay={(event) => {
          if (Date.now() < source.expiresAt - URL_EXPIRY_MARGIN_MS || isLoading) return;
          const audio = event.currentTarget;
          audio.pause();
          void loadUrl({ time: audio.currentTime, play: true });
        }}
        onError={(event) => {
          const audio = event.currentTarget;
          if (refreshCountRef.current >= MAX_URL_REFRESHES) {
            setError("녹음을 재생하지 못했습니다.");
            return;
          }
          refreshCountRef.current += 1;
          void loadUrl({ time: audio.currentTime, play: !audio.paused || resumeRef.current?.play === true });
        }}
      />
      {error && (
        <p className={styles["meeting-recording-error"]} role="alert">
          {error}{" "}
          <button
            type="button"
            className={styles["meeting-recording-retry"]}
            onClick={() => {
              refreshCountRef.current = 0;
              void loadUrl({ time: audioRef.current?.currentTime ?? 0, play: true });
            }}
          >
            다시 시도
          </button>
        </p>
      )}
    </div>
  );
}
