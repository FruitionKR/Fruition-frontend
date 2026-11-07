/**
 * 랜딩 시연 영상 목록과 재생 판단. 파일은 web/public/landing에 있다.
 * CDN으로 옮길 때는 LANDING_MEDIA_BASE만 바꾸고, CSP의 media-src·img-src에 그 출처를 더한다.
 */

const LANDING_MEDIA_BASE = "/landing";

export type LandingVideoId =
  | "pdf-upload"
  | "document-editor"
  | "wiki-ingest"
  | "wiki-lint"
  | "query"
  | "ai-edit"
  | "skill-create"
  | "skill-run";

export interface LandingVideo {
  readonly src: string;
  readonly poster: string;
  readonly width: number;
  readonly height: number;
}

// 영상 제목·설명과 스크린리더 설명(label)은 언어별 메시지 landing.videos.<id>에 있다. 영상에 소리가 없어 label이 내용을 대신한다.
// 영상 속 앱 화면은 한국어로 녹화돼 있어 영어 화면에서도 그대로 보인다.
function landingVideo(id: LandingVideoId, width: number, height: number): LandingVideo {
  return { src: `${LANDING_MEDIA_BASE}/${id}.mp4`, poster: `${LANDING_MEDIA_BASE}/${id}.webp`, width, height };
}

export const LANDING_VIDEOS: Readonly<Record<LandingVideoId, LandingVideo>> = {
  "pdf-upload": landingVideo("pdf-upload", 1600, 1042),
  "document-editor": landingVideo("document-editor", 1600, 1044),
  "wiki-ingest": landingVideo("wiki-ingest", 1600, 802),
  "wiki-lint": landingVideo("wiki-lint", 1600, 1042),
  query: landingVideo("query", 1600, 1042),
  "ai-edit": landingVideo("ai-edit", 1600, 1044),
  "skill-create": landingVideo("skill-create", 1600, 1042),
  "skill-run": landingVideo("skill-run", 1600, 1042)
};

/** auto는 화면에 따라 자동으로, playing·paused는 사용자가 버튼으로 고른 상태다. */
export type VideoChoice = "auto" | "playing" | "paused";

export function shouldPlayVideo({
  isInView,
  reduceMotion,
  choice,
  isBlocked
}: {
  isInView: boolean;
  reduceMotion: boolean;
  choice: VideoChoice;
  isBlocked: boolean;
}): boolean {
  if (!isInView || choice === "paused") return false;
  if (choice === "playing") return true;
  return !reduceMotion && !isBlocked;
}

/** play()를 pause()나 소스 변경이 끊은 경우. 재생 거부(저전력 모드 등)와 구분한다. */
export function isVideoPlayAborted(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "AbortError";
}

export function videoControlState({ wantsPlay, hasFailed }: { wantsPlay: boolean; hasFailed: boolean }): "play" | "pause" | "hidden" {
  if (hasFailed) return "hidden";
  return wantsPlay ? "pause" : "play";
}
