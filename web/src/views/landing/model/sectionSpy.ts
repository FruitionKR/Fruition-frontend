import { LANDING_CHAPTERS, type LandingChapterId } from "./landingContent";

/**
 * 고정 탭 바의 현재 장. 감시 영역 안에 보이는 장 가운데 문서 순서상 첫 장을 고른다.
 * 보이는 장이 없으면(장 사이 여백) 직전 값을 유지해 강조가 깜빡이지 않게 한다.
 */
export function pickActiveChapter(
  visible: ReadonlySet<LandingChapterId>,
  current: LandingChapterId | null
): LandingChapterId | null {
  const first = LANDING_CHAPTERS.find((chapter) => visible.has(chapter.id));
  return first ? first.id : current;
}
