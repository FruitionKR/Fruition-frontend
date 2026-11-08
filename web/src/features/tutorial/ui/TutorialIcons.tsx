import type { ReactNode } from "react";
import type { TutorialIcon } from "../model/tutorialContent";

// 튜토리얼 섹션·단계 아이콘. 레일 아이콘(RailIcons.tsx)과 같은 24 그리드·선 굵기 1.6·둥근 끝으로 그리고
// 색은 currentColor라 라이트·다크 테마를 따른다.

function Icon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      aria-hidden
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const PATHS: Record<TutorialIcon, ReactNode> = {
  // 깃발
  start: (
    <>
      <path d="M6 20.5V4" />
      <path d="M6 4.5h10.2l-1.9 3.6 1.9 3.6H6" />
    </>
  ),
  // 접힌 모서리 문서 + 줄
  document: (
    <>
      <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3.5v5h5" />
      <path d="M9 13h6M9 16.5h4" />
    </>
  ),
  // 위 화살표 + 받침
  upload: (
    <>
      <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9" />
      <path d="M4.5 15v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" />
    </>
  ),
  // 문서 + PDF 띠
  pdf: (
    <>
      <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3.5v5h5" />
      <path d="M3.5 12.5h11v5h-11z" />
    </>
  ),
  // 펼친 책
  wiki: (
    <>
      <path d="M12 6.5c-1.8-1.4-4.3-2-7.5-2v13c3.2 0 5.7.6 7.5 2 1.8-1.4 4.3-2 7.5-2v-13c-3.2 0-5.7.6-7.5 2z" />
      <path d="M12 6.5v13" />
    </>
  ),
  // 노드 셋과 연결선
  graph: (
    <>
      <circle cx="6.5" cy="12" r="2.5" />
      <circle cx="17.5" cy="6" r="2.5" />
      <circle cx="17.5" cy="18" r="2.5" />
      <path d="m8.7 10.8 6.6-3.6M8.7 13.2l6.6 3.6" />
    </>
  ),
  // 말풍선
  chat: (
    <>
      <path d="M20 11.5a7.5 7 0 0 1-10.6 6.4L4.5 19.5l1.4-4A7 7 0 0 1 4.5 11.5 7.5 7 0 0 1 20 11.5z" />
      <path d="M9 11.5h.01M12.25 11.5h.01M15.5 11.5h.01" />
    </>
  ),
  // 반짝임(AI 에이전트)
  agent: (
    <>
      <path d="M11 4.5c.5 3.6 2 5.1 5.5 5.5-3.5.4-5 1.9-5.5 5.5-.5-3.6-2-5.1-5.5-5.5 3.5-.4 5-1.9 5.5-5.5z" />
      <path d="M17.5 15c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z" />
    </>
  ),
  // 번개(레일 스킬 아이콘과 같은 모양)
  skill: <path d="M18.5 10.5 11.2 20v-6H5.5l7.3-9.5v6z" />,
  // 마이크
  meeting: (
    <>
      <rect x="9" y="3.5" width="6" height="10.5" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3" />
    </>
  ),
  // 상자로 들어오는 화살표
  import: (
    <>
      <path d="M12 3.5v9.5M8 9l4 4 4-4" />
      <path d="M4.5 13.5 6 19a2 2 0 0 0 2 1.5h8a2 2 0 0 0 2-1.5l1.5-5.5" />
    </>
  ),
  // 조절 막대
  settings: (
    <>
      <path d="M4.5 7.5h8M16.5 7.5h3M4.5 16.5h3M11.5 16.5h8" />
      <circle cx="14.5" cy="7.5" r="2" />
      <circle cx="9.5" cy="16.5" r="2" />
    </>
  ),
  // 지구본
  language: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.2 2.3 3.2 5 3.2 8s-1 5.7-3.2 8c-2.2-2.3-3.2-5-3.2-8s1-5.7 3.2-8z" />
    </>
  ),
  // 목록 + 시계
  log: (
    <>
      <path d="M4.5 6.5h9M4.5 11h6M4.5 15.5h4" />
      <circle cx="16" cy="15" r="4.5" />
      <path d="M16 13v2l1.3 1.2" />
    </>
  )
};

/** 튜토리얼 아이콘 한 개. 알 수 없는 이름이면 그리지 않는다(내용이 먼저 바뀐 경우). */
export function TutorialIconGlyph({ name, className }: { name: TutorialIcon; className?: string }) {
  const paths = PATHS[name];
  return paths ? <Icon className={className}>{paths}</Icon> : null;
}
