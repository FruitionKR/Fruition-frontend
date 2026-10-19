/**
 * 랜딩 화면 문구와 구조. 히어로 → 장 목차 → 01 모으고 쓰기 → 02 지식으로 연결 → 03 활용 → 04 팀으로 확장
 * → FAQ → 마지막 안내 순서다. 장 제목·본문·기능 칩은 사용자가 정한 문구를 그대로 쓴다(영어 부제·괄호 병기 포함).
 */

export type LandingChapterId = "capture" | "connect" | "discover" | "together";

export interface LandingNavItem {
  readonly href: `#${LandingChapterId}`;
  readonly label: string;
}

export const LANDING_NAV: readonly LandingNavItem[] = [
  { href: "#capture", label: "모으기" },
  { href: "#connect", label: "연결하기" },
  { href: "#discover", label: "활용하기" },
  { href: "#together", label: "함께하기" }
];

export interface LandingChapter {
  readonly id: LandingChapterId;
  readonly index: string;
  /** 장 목차에 쓰는 짧은 이름 */
  readonly indexLabel: string;
  /** 장 이름과 영어 부제: "01. 지식 작성 및 편집 (CAPTURE & ORGANIZE)" */
  readonly name: string;
  readonly english: string;
  readonly headline: string;
  /** 제목 옆 괄호 부제: "(모으고 쓰기)" */
  readonly headlineNote: string;
  readonly body: string;
  readonly chips: readonly string[];
  /** 화면 조각 위치. 01·03은 왼쪽, 02·04는 오른쪽 */
  readonly visualSide: "left" | "right";
}

export const LANDING_CHAPTERS: readonly LandingChapter[] = [
  {
    id: "capture",
    index: "01",
    indexLabel: "모으고 쓰기",
    name: "지식 작성 및 편집",
    english: "CAPTURE & ORGANIZE",
    headline: "흩어진 기록을 한곳에 모으고",
    headlineNote: "모으고 쓰기",
    body:
      "PDF·Markdown·TXT 문서를 올리고, PDF는 편집 가능한 Markdown으로 변환하세요. 아이디어부터 회의록까지 자유롭게 기록하세요. 모든 자료를 한곳에서 작성하고 체계적으로 정리할 수 있습니다.",
    chips: ["문서 업로드", "PDF Markdown으로 변환", "Markdown 편집", "회의 받아쓰기 및 AI 회의록", "폴더 관리"],
    visualSide: "left"
  },
  {
    id: "connect",
    index: "02",
    indexLabel: "지식으로 연결",
    name: "LLM Wiki 기반 지식 관리",
    english: "CONNECT THE DOTS",
    headline: "개별 기록을 연결된 지식으로 만들고",
    headlineNote: "지식으로 연결하기",
    body:
      "문서 속 개념과 관계를 발견해 나만의 지식 위키를 구축하세요. 지식 그래프로 연결된 맥락을 탐색하고, 품질 검사와 변경 이력 관리로 신뢰할 수 있는 지식을 유지합니다.",
    chips: ["문서와 채팅 위키 편입(Ingest)", "지식 그래프(Graph)", "지식 품질 검사(Lint)", "AI 로그 이력 · 롤백(History)"],
    visualSide: "right"
  },
  {
    id: "discover",
    index: "03",
    indexLabel: "활용",
    name: "AI로 지식 활용",
    english: "PUT KNOWLEDGE TO WORK",
    headline: "필요한 순간, 지식을 찾아 활용하고",
    headlineNote: "근거있는 지식 찾고 활용하기",
    body:
      "쌓아둔 지식에 질문하고, 관련된 정보를 빠르게 찾아보세요. AI 스킬과 편집 기능을 활용하면 단순한 정보 검색을 넘어 새로운 콘텐츠와 실질적인 결과물로 발전시킬 수 있습니다.",
    chips: ["자연어 질의응답(Query)", "답변 근거 확인", "AI 문서 편집(Edit)", "스킬 생성 및 실행(Skill)"],
    visualSide: "left"
  },
  {
    id: "together",
    index: "04",
    indexLabel: "팀으로 확장",
    name: "협업",
    english: "BUILD TOGETHER",
    headline: "개인의 기록을 팀의 지식으로 확장하세요",
    headlineNote: "팀의 지식으로 확장하기",
    body:
      "팀원을 초대해 워크스페이스 내에서 지식을 공유하고 함께 발전시키세요. 역할별 접근 권한과 자동 병합·버전 기록으로 여러 사람이 안전하게 지식을 축적하고 관리할 수 있습니다.",
    chips: ["팀 워크스페이스", "멤버 초대", "권한 관리", "안전한 공동 편집", "팀 스킬 공유"],
    visualSide: "right"
  }
];

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
