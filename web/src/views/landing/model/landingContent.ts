/**
 * 랜딩 화면 문구와 구조. 히어로 → 시연 영상 3묶음 → 함께하기 → 문서 보호 → FAQ → 마지막 안내 순서다.
 * 함께하기 문구와 기능 칩은 사용자가 정한 문구를 그대로 쓴다(영어 부제·괄호 병기 포함).
 */

import type { LandingVideoId } from "./landingVideos";

export interface LandingNavItem {
  readonly href: "#data-handling";
  readonly label: string;
}

export const LANDING_NAV: readonly LandingNavItem[] = [{ href: "#data-handling", label: "문서 보호" }];

/** 헤더 메뉴 이름. 메뉴가 가리키는 섹션의 h2로도 쓴다. */
export function landingNavLabel(href: LandingNavItem["href"]): string {
  const item = LANDING_NAV.find((navItem) => navItem.href === href);
  if (!item) throw new Error(`헤더 메뉴에 없는 앵커: ${href}`);
  return item.label;
}

/** 영상으로 다루지 않는 협업 소개. */
export const LANDING_TOGETHER = {
  title: "함께하기",
  name: "협업",
  english: "BUILD TOGETHER",
  headline: "개인의 기록을 팀의 지식으로 확장하세요",
  body:
    "팀원을 초대해 워크스페이스 내에서 지식을 공유하고 함께 발전시키세요. 역할별 접근 권한과 자동 병합·버전 기록으로 여러 사람이 안전하게 지식을 축적하고 관리할 수 있습니다.",
  chips: ["팀 워크스페이스", "멤버 초대", "권한 관리", "안전한 공동 편집", "팀 스킬 공유"]
} as const;

export interface LandingDemoStep {
  readonly videoId: LandingVideoId;
  readonly title: string;
  readonly body: string;
}

export interface LandingDemoSlot {
  readonly id: "upload" | "connect-ask" | "edit-skill";
  readonly index: string;
  readonly english: string;
  readonly title: string;
  readonly body: string;
  readonly steps: readonly LandingDemoStep[];
  /** 영상에 나오지 않지만 이 묶음에 속하는 기능 */
  readonly chips: readonly string[];
}

/** 시연 흐름: 올리기 → 편입·질의 → AI 편집·스킬. 묶음마다 기능별 시연 영상을 차례로 보여 주며 프로젝트를 설명한다. */
export const LANDING_DEMO_SLOTS: readonly LandingDemoSlot[] = [
  {
    id: "upload",
    index: "01",
    english: "UPLOAD & WRITE",
    title: "올리고 쓰기",
    body: "PDF를 올리면 고칠 수 있는 Markdown 문서로 바꿉니다. 표까지 옮겨 오므로 바로 이어서 쓸 수 있습니다.",
    steps: [
      { videoId: "pdf-upload", title: "PDF 올리고 변환하기", body: "메뉴에서 변환을 고르면 원본 PDF 옆에 Markdown 변환본이 생깁니다." },
      { videoId: "document-editor", title: "문서 편집", body: "/를 입력해 제목·목록·표를 넣고, 글자를 골라 서식을 바꿉니다." }
    ],
    chips: ["회의 받아쓰기 및 AI 회의록", "폴더 관리"]
  },
  {
    id: "connect-ask",
    index: "02",
    english: "INGEST & ASK",
    title: "편입하고 묻기",
    body: "문서를 위키에 편입하면 그래프로 연결됩니다. 질문하면 위키에서 찾은 자료를 근거로 답합니다.",
    steps: [
      { videoId: "wiki-ingest", title: "위키에 편입하기", body: "문서를 골라 편입하면 진행률이 표시되고, 끝나면 그래프에 페이지가 이어집니다." },
      { videoId: "wiki-lint", title: "위키 최신화(Lint)", body: "위키 페이지를 다듬고, 새로 찾은 개념과 연결을 그래프에 더합니다." },
      { videoId: "query", title: "질문하기", body: "위키에서 찾은 자료로 답하고, 번호를 누르면 본문의 근거 위치를 보여 줍니다." }
    ],
    chips: ["문서와 채팅 위키 편입(Ingest)", "AI 로그 이력", "롤백(History)"]
  },
  {
    id: "edit-skill",
    index: "03",
    english: "EDIT & SKILL",
    title: "AI로 고치고 스킬로 저장하기",
    body: "고칠 내용을 요청하면 AI가 본문에 제안을 표시하고, 수락한 제안만 반영합니다. 자주 하는 요청은 스킬로 저장해 다시 씁니다.",
    steps: [
      { videoId: "ai-edit", title: "AI로 고치기", body: "요청하면 본문에 제안을 표시합니다. 수락하면 그 내용만 문서에 반영합니다." },
      { videoId: "skill-create", title: "스킬 만들기", body: "실행 규칙을 적어 AI로 다듬고, 문서를 바꾸지 않는 테스트 실행으로 결과를 확인합니다." },
      { videoId: "skill-run", title: "스킬 실행하기", body: "/명령으로 스킬을 부르면 같은 규칙으로 고친 제안을 본문에 표시합니다." }
    ],
    chips: []
  }
];

/** "기능 둘러보기"와 건너뛰기 링크가 가리키는 첫 영상 묶음 */
export const LANDING_FIRST_DEMO_ANCHOR = `#demo-${LANDING_DEMO_SLOTS[0].id}`;

export interface LandingFaq {
  readonly question: string;
  readonly answer: string;
}

export const LANDING_FAQ: readonly LandingFaq[] = [
  {
    question: "일반 AI 채팅과 무엇이 다른가요?",
    answer: "올린 문서를 위키로 정리해 두고, 그 위키를 근거로 답합니다. 답변마다 어떤 문서를 참고했는지 함께 보여 줍니다."
  },
  {
    question: "어떤 자료를 올릴 수 있나요?",
    answer: "PDF·Markdown·TXT 문서를 올리거나 화면에서 바로 문서를 쓸 수 있습니다. 회의는 녹음하거나 녹음 파일을 올려 회의록으로 남깁니다."
  },
  {
    question: "올린 문서는 바로 위키에 들어가나요?",
    answer: "워크스페이스 설정에 따라 자동으로 편입하거나, 원하는 문서만 골라 편입할 수 있습니다."
  },
  {
    question: "지금 바로 써 볼 수 있나요?",
    answer: "테스트 운영 중입니다. 운영 환경에 따라 접근 코드가 필요할 수 있고, 기능과 화면은 바뀔 수 있습니다."
  }
];
