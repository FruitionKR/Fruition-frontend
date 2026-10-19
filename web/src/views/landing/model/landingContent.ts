/**
 * 랜딩 화면 문구와 구조. 기능 소개 사이트(디자인 참고용)의 흐름(기록 → 지식화 → 활용 → 협업)을 따르되,
 * 문구는 실제 제품 기능(문서 업로드·위키 편입·근거 있는 답변·스킬·회의 받아쓰기·워크스페이스 권한)에 맞춘다.
 */

export type LandingChapterId = "capture" | "connect" | "discover" | "together";

export interface LandingFeature {
  readonly title: string;
  readonly description: string;
}

export interface LandingChapter {
  readonly id: LandingChapterId;
  readonly index: string;
  /** 상단 메뉴 이름 */
  readonly navLabel: string;
  /** 장 목차에 쓰는 짧은 이름 */
  readonly indexLabel: string;
  readonly kicker: string;
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly showcase: {
    readonly kicker: string;
    readonly title: readonly [string, string];
    readonly caption: string;
  };
  readonly features: readonly LandingFeature[];
}

export const LANDING_CHAPTERS: readonly LandingChapter[] = [
  {
    id: "capture",
    index: "01",
    navLabel: "기록",
    indexLabel: "모으고 쓰기",
    kicker: "CAPTURE & ORGANIZE",
    title: "흩어진 기록을 한곳에 모으고",
    subtitle: "지식 작성 및 편집",
    description:
      "PDF·Markdown·TXT 문서를 올리고, PDF는 편집 가능한 Markdown으로 변환하세요. 아이디어부터 회의록까지 한곳에서 작성하고 폴더로 정리할 수 있습니다.",
    showcase: {
      kicker: "DOCUMENT WORKSPACE",
      title: ["기록부터 편집까지,", "하나의 흐름으로."],
      caption: "문서와 AI 에이전트를 같은 화면에서 만나보세요."
    },
    features: [
      { title: "문서 업로드", description: "PDF·Markdown·TXT 문서를 한곳에 모으세요." },
      { title: "PDF를 Markdown으로 변환", description: "PDF를 편집 가능한 Markdown 문서로 바꿔 이어서 다듬으세요." },
      { title: "Markdown 편집", description: "아이디어부터 회의록까지 자유롭게 기록하세요." },
      { title: "회의 받아쓰기와 AI 회의록", description: "회의를 녹음하거나 녹음 파일을 올려 AI 회의록으로 정리하세요." },
      { title: "폴더 관리", description: "모든 자료를 폴더로 체계적으로 정리하세요." }
    ]
  },
  {
    id: "connect",
    index: "02",
    navLabel: "지식화",
    indexLabel: "지식으로 연결하기",
    kicker: "CONNECT THE DOTS",
    title: "개별 기록을 연결된 지식으로 만들고",
    subtitle: "LLM Wiki 기반 지식 관리",
    description:
      "문서와 채팅을 위키에 편입하면 개념과 출처 페이지로 정리됩니다. 지식 그래프로 맥락을 탐색하고, 품질 검사와 작업 이력으로 믿을 수 있는 지식을 유지하세요.",
    showcase: {
      kicker: "LLM WIKI",
      title: ["문서의 내용이,", "연결된 지식이 됩니다."],
      caption: "개념과 출처를 따라가며 다음 질문의 실마리를 찾으세요."
    },
    features: [
      { title: "위키 편입(Ingest)", description: "문서와 채팅 기록을 개념·출처 페이지로 편입하세요." },
      { title: "지식 그래프(Graph)", description: "문서 속 개념과 관계를 그래프로 살펴보세요." },
      { title: "지식 품질 검사(Lint)", description: "끊긴 연결과 어긋난 내용을 찾아 지식을 깔끔하게 유지하세요." },
      { title: "작업 이력과 롤백(History)", description: "AI 작업 이력을 확인하고, 필요하면 이전 상태로 되돌리세요." }
    ]
  },
  {
    id: "discover",
    index: "03",
    navLabel: "활용",
    indexLabel: "근거 있게 찾고 활용하기",
    kicker: "PUT KNOWLEDGE TO WORK",
    title: "필요한 순간, 지식을 찾아 활용하고",
    subtitle: "AI로 지식 활용",
    description:
      "쌓아둔 지식에 질문하고 답변의 근거를 바로 확인하세요. AI 에이전트와 스킬을 쓰면 검색을 넘어 문서 편집과 새로운 결과물까지 이어집니다.",
    showcase: {
      kicker: "ASK WITH SOURCES",
      title: ["답변마다", "근거가 따라옵니다."],
      caption: "예시 질문과 응답입니다. 실제 AI를 호출하지 않습니다."
    },
    features: [
      { title: "자연어 질의응답(Query)", description: "쌓아둔 지식에 질문하고 관련 정보를 빠르게 찾으세요." },
      { title: "답변 근거 확인", description: "답변이 인용한 문서와 위키 페이지를 바로 열어보세요." },
      { title: "AI 문서 편집(Edit)", description: "에이전트와 함께 문서를 고치고 새 콘텐츠로 발전시키세요." },
      { title: "스킬 생성과 실행(Skill)", description: "반복하는 작업을 AI 스킬로 만들어 언제든 실행하세요." }
    ]
  },
  {
    id: "together",
    index: "04",
    navLabel: "협업",
    indexLabel: "팀의 지식으로 확장하기",
    kicker: "BUILD TOGETHER",
    title: "개인의 기록을 팀의 지식으로 확장하세요",
    subtitle: "협업",
    description:
      "팀원을 워크스페이스에 초대해 지식을 함께 쌓으세요. 역할별 권한과 편집 충돌 관리로 여러 사람이 안전하게 같은 지식을 다룰 수 있습니다.",
    showcase: {
      kicker: "SHARED WORKSPACE",
      title: ["각자의 기록을,", "팀의 자산으로."],
      caption: "예시 화면입니다."
    },
    features: [
      { title: "팀 워크스페이스", description: "기록을 공유하고 팀의 지식을 함께 발전시키세요." },
      { title: "멤버 초대", description: "초대 메일로 팀원을 불러 같은 워크스페이스에서 일하세요." },
      { title: "권한 관리", description: "소유자와 멤버 역할로 접근 범위를 나누세요." },
      { title: "안전한 공동 편집", description: "다른 사람과 편집이 겹치면 충돌 기록을 확인하고 안전하게 합치세요." },
      { title: "팀 스킬 공유", description: "유용한 스킬을 팀과 공유하고 함께 쓰세요." }
    ]
  }
];

export interface LandingFlowStep {
  readonly index: string;
  readonly title: string;
  readonly detail: string;
}

export const LANDING_FLOW: readonly LandingFlowStep[] = [
  { index: "01", title: "모으고 쓰기", detail: "문서 · 파일 · 회의" },
  { index: "02", title: "지식으로 연결하기", detail: "위키 편입 · 그래프" },
  { index: "03", title: "찾고 활용하기", detail: "질의응답 · AI 편집 · 스킬" },
  { index: "04", title: "팀의 지식으로 확장하기", detail: "워크스페이스 · 권한" }
];

export interface LandingFaq {
  readonly question: string;
  readonly answer: string;
}

export const LANDING_FAQ: readonly LandingFaq[] = [
  {
    question: "문서 저장이나 일반 AI 채팅과 무엇이 다른가요?",
    answer:
      "Fruition은 올린 문서를 위키에 편입해 개념과 출처로 연결합니다. 질문하면 그 위키를 근거로 답하고, 어떤 문서를 인용했는지 함께 보여줍니다."
  },
  {
    question: "어떤 자료로 시작할 수 있나요?",
    answer:
      "PDF·Markdown·TXT 문서를 올리거나 화면에서 바로 Markdown 문서를 쓸 수 있습니다. 회의는 녹음하거나 녹음 파일을 올려 회의록으로 남길 수 있습니다."
  },
  {
    question: "업로드한 문서는 바로 Wiki에 포함되나요?",
    answer:
      "워크스페이스 설정에 따라 자동으로 편입하거나, 원하는 문서만 골라 직접 편입할 수 있습니다. 편입 이후 수정한 문서는 다시 편입해 최신 상태로 맞춥니다."
  },
  {
    question: "AI 답변의 근거도 확인할 수 있나요?",
    answer: "네. 답변에 인용된 문서와 위키 페이지가 함께 표시되고, 눌러서 원문을 바로 열어볼 수 있습니다."
  },
  {
    question: "혼자 사용하다가 팀과 함께 쓸 수 있나요?",
    answer:
      "워크스페이스에 팀원을 초대하면 같은 문서와 위키를 함께 씁니다. 소유자와 멤버 역할로 권한을 나누고, 편집 충돌은 확인 후 합칠 수 있습니다."
  },
  {
    question: "지금 바로 사용해 볼 수 있나요?",
    answer: "Fruition은 테스트 운영 중입니다. 운영 환경에 따라 접근 코드가 필요할 수 있고, 기능과 화면은 바뀔 수 있습니다."
  }
];

export type TabKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

/** WAI-ARIA 탭 목록 키보드 이동. 좌우 화살표는 양 끝에서 반대쪽으로 넘어가고, 다른 키는 현재 위치를 유지한다. */
export function nextTabIndex(current: number, key: string, count: number): number {
  if (count <= 0) return current;
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return current;
  }
}
