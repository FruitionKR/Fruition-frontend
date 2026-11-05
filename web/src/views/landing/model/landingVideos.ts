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
  /** 스크린리더가 읽는 설명. 영상에 소리가 없어 이 설명이 내용을 대신한다. */
  readonly label: string;
}

function landingVideo(id: LandingVideoId, width: number, height: number, label: string): LandingVideo {
  return { src: `${LANDING_MEDIA_BASE}/${id}.mp4`, poster: `${LANDING_MEDIA_BASE}/${id}.webp`, width, height, label };
}

export const LANDING_VIDEOS: Readonly<Record<LandingVideoId, LandingVideo>> = {
  "pdf-upload": landingVideo("pdf-upload", 1600, 1042, "PDF를 올리고 메뉴에서 Markdown으로 변환해, 표까지 옮겨진 변환본을 여는 화면 녹화"),
  "document-editor": landingVideo("document-editor", 1600, 1044, "새 노트에 제목을 쓰고 / 메뉴로 목록과 표를 넣은 뒤 글자 서식을 바꾸는 화면 녹화"),
  "wiki-ingest": landingVideo("wiki-ingest", 1600, 802, "문서를 골라 위키에 편입하고, 진행률이 끝나면 그래프에 새 페이지가 이어지는 화면 녹화"),
  "wiki-lint": landingVideo("wiki-lint", 1600, 1042, "위키 최신화를 실행해 페이지를 다듬고 그래프에 개념과 연결이 늘어나는 화면 녹화"),
  query: landingVideo("query", 1600, 1042, "문서를 연 채 질문하고, 답변의 번호를 눌러 본문의 근거 위치를 확인하는 화면 녹화"),
  "ai-edit": landingVideo("ai-edit", 1600, 1044, "AI에게 편집을 요청해 본문에 표시된 제안을 수락하고, 표로 정리된 문서를 확인하는 화면 녹화"),
  "skill-create": landingVideo("skill-create", 1600, 1042, "실행 규칙을 적어 AI로 다듬고 테스트 실행으로 결과를 확인한 뒤 스킬을 저장하는 화면 녹화"),
  "skill-run": landingVideo("skill-run", 1600, 1042, "메모 문서에서 / 명령으로 스킬을 실행해 본문에 제안이 표시되는 화면 녹화")
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
