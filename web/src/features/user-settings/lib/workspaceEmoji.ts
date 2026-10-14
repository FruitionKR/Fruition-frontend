// 워크스페이스 아이콘 이모티콘 입력 규칙. OS 이모티콘 선택기로 넣은 값에서 이모티콘 한 글자만 받는다.

const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u;

/** 입력값에서 첫 이모티콘 한 글자(결합·피부색·ZWJ 포함)를 돌려준다. 이모티콘이 아니면 null이다. */
export function pickEmoji(value: string): string | null {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const { segment } of segmenter.segment(value)) {
    if (EMOJI_PATTERN.test(segment)) return segment;
  }
  return null;
}

/** OS별 이모티콘 선택기 단축키 안내 */
export function emojiPickerHint(platform: string): string {
  if (/mac|iphone|ipad/i.test(platform)) return "⌃⌘Space";
  if (/win/i.test(platform)) return "Win + .";
  return "OS 이모티콘 선택기";
}
