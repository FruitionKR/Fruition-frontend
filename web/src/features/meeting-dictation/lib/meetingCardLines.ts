// 회의록 카드에 보일 줄 (Figma 1540:22995). 시안은 Markdown 원문을 고정폭으로 보여 주되
// 문서 제목(# …)만 맨 앞에 두고 나머지 줄은 두 칸 들여 쓴다. 목록 항목이 줄바꿈되면 이어진 줄은
// 기호(- ) 뒤에 맞춘다("    다."). 할 일(- [ ] · - [x])은 체크박스 뒤에 맞춘다. 소제목(###·####)과
// 머리 줄(- 날짜:·- 참석자:)도 두 칸 들여 쓴다. 원문은 바꾸지 않고 줄마다 들여쓰기 폭(ch)만 계산한다.

const BODY_INDENT_CH = 2;
const TITLE_PATTERN = /^# /;
const LIST_MARKER_PATTERN = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/;

export type MeetingCardLine = {
  text: string;
  /** 줄 전체를 들여 쓰는 폭(ch) */
  indent: number;
  /** 줄바꿈된 이어진 줄을 더 들여 쓰는 폭(ch). 목록 기호(할 일은 체크박스까지) 폭이다. */
  hanging: number;
};

export function meetingCardLines(body: string): MeetingCardLine[] {
  return body.split("\n").map((text) => {
    if (TITLE_PATTERN.test(text)) return { text, indent: 0, hanging: 0 };
    const marker = LIST_MARKER_PATTERN.exec(text);
    return { text, indent: BODY_INDENT_CH, hanging: marker ? marker[0].length : 0 };
  });
}
