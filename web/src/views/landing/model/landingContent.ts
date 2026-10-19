/**
 * 랜딩 화면 문구와 구조. 히어로 → 흐름도 → 핵심 기능 3개(좌우 교차) → 기능 묶음(벤토) → 팀(어두운 띠)
 * → 활용 사례 탭 → FAQ → 마지막 안내 순서다. 문구는 실제 제품 기능(문서 업로드·PDF 변환·위키 편입·지식 그래프·
 * 근거 있는 답변·승인 편집·스킬·회의 받아쓰기·위키 점검·작업 이력·워크스페이스 권한)에 맞추고, 영어 병기는 쓰지 않는다.
 */

export interface LandingNavItem {
  readonly href: `#${string}`;
  readonly label: string;
}

export const LANDING_NAV: readonly LandingNavItem[] = [
  { href: "#capture", label: "기능" },
  { href: "#more", label: "더 많은 기능" },
  { href: "#team", label: "팀" },
  { href: "#use-cases", label: "활용 사례" }
];

export type LandingFeatureId = "capture" | "connect" | "discover";

export interface LandingFeature {
  readonly id: LandingFeatureId;
  readonly label: string;
  readonly title: readonly [string, string];
  readonly description: string;
  readonly points: readonly string[];
}

export const LANDING_FEATURES: readonly LandingFeature[] = [
  {
    id: "capture",
    label: "올리기 · 변환",
    title: ["흩어진 자료를", "한곳에 올리세요"],
    description: "PDF·Markdown·텍스트 문서를 끌어다 놓으면 폴더에 정리되고, PDF는 바로 고쳐 쓸 수 있는 Markdown 문서로 바뀝니다.",
    points: ["PDF를 편집 가능한 Markdown으로 변환", "폴더로 정리하고 통합 검색", "변환이 끝나면 앱 안에서 알림"]
  },
  {
    id: "connect",
    label: "위키 · 그래프",
    title: ["올린 문서가", "스스로 위키가 됩니다"],
    description: "문서를 위키에 편입하면 핵심 개념과 출처가 페이지로 정리되고, 서로 어떻게 이어지는지 그래프로 보입니다.",
    points: ["개념 페이지와 출처 페이지를 자동으로 정리", "자동 편입 또는 원하는 문서만 골라 편입", "그래프에서 맥락을 따라 탐색"]
  },
  {
    id: "discover",
    label: "근거 있는 답변",
    title: ["답변마다", "출처가 따라옵니다"],
    description: "쌓아 둔 위키에 질문하면 답변 문장마다 근거 번호가 붙고, 눌러서 원문을 바로 확인할 수 있습니다.",
    points: ["답변 문장마다 근거 번호 표시", "참고한 문서와 위키 페이지를 한눈에", "원문을 열어 해당 부분 확인"]
  }
];

export interface LandingBentoItem {
  readonly id: "approve" | "skills" | "dictation" | "lint" | "history";
  readonly title: string;
  readonly description: string;
}

export const LANDING_BENTO: readonly LandingBentoItem[] = [
  {
    id: "approve",
    title: "승인하고 반영하는 AI 편집",
    description: "에이전트가 문서를 고치면 바뀐 부분이 제안으로 표시되고, 수락한 것만 반영됩니다."
  },
  {
    id: "skills",
    title: "슬래시로 부르는 스킬",
    description: "반복하는 작업을 스킬로 만들어 두고 / 한 번으로 실행하세요. 팀과 공유할 수도 있습니다."
  },
  {
    id: "dictation",
    title: "회의 받아쓰기",
    description: "회의를 녹음하거나 녹음 파일을 올리면 받아쓴 내용이 회의록 초안으로 정리됩니다."
  },
  {
    id: "lint",
    title: "위키 점검",
    description: "위키 전체를 점검해 합치거나 다듬을 부분을 제안하고, 수락한 것만 반영합니다."
  },
  {
    id: "history",
    title: "작업 이력과 되돌리기",
    description: "AI가 한 작업은 모두 기록되고, 필요하면 이전 상태로 되돌릴 수 있습니다."
  }
];

export interface LandingTeamPoint {
  readonly title: string;
  readonly description: string;
}

export const LANDING_TEAM_POINTS: readonly LandingTeamPoint[] = [
  { title: "팀 워크스페이스", description: "초대 메일로 팀원을 부르고 같은 문서와 위키를 함께 씁니다." },
  { title: "역할별 권한", description: "소유자와 멤버 역할로 할 수 있는 일을 나눕니다." },
  { title: "안전한 공동 편집", description: "편집이 겹치면 충돌 기록을 남기고, 확인한 뒤 합칩니다." },
  { title: "계정 보안", description: "로그인된 기기를 확인하고, 쓰지 않는 기기는 바로 로그아웃합니다." }
];

export interface LandingUseCase {
  readonly key: "lab" | "startup" | "student";
  readonly tab: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly string[];
  readonly question: string;
}

export const LANDING_USE_CASES: readonly LandingUseCase[] = [
  {
    key: "lab",
    tab: "연구실",
    title: "논문과 실험 노트를 연구실 위키로",
    description: "선배가 남긴 자료와 새로 읽은 논문을 한곳에 모아, 누구나 같은 맥락에서 연구를 이어 갑니다.",
    steps: ["논문 PDF와 실험 노트를 올린다", "개념별 위키 페이지로 정리된다", "출처를 확인하며 선행 연구를 정리한다"],
    question: "우리 실험 조건과 비슷한 선행 연구를 출처와 함께 정리해 줘"
  },
  {
    key: "startup",
    tab: "스타트업",
    title: "회의와 고객 인터뷰를 팀의 기억으로",
    description: "매주 쌓이는 회의록과 인터뷰가 흩어지지 않고, 새로 온 팀원도 지난 결정을 근거와 함께 찾습니다.",
    steps: ["회의를 받아쓰고 회의록으로 정리한다", "인터뷰 노트를 위키에 편입한다", "결정 배경을 출처와 함께 묻는다"],
    question: "지난 분기에 가격 정책을 바꾼 이유가 뭐였지?"
  },
  {
    key: "student",
    tab: "학생",
    title: "강의 자료를 시험 전 나만의 위키로",
    description: "강의 슬라이드와 필기를 올려 두면 개념끼리 이어지고, 헷갈리는 부분은 원문을 근거로 다시 확인합니다.",
    steps: ["강의 자료와 필기를 올린다", "개념 그래프로 단원 사이 연결을 본다", "헷갈리는 개념을 근거와 함께 묻는다"],
    question: "3주차와 7주차 내용이 어떻게 이어지는지 설명해 줘"
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
    answer: "PDF·Markdown·텍스트 문서를 올리거나 화면에서 바로 문서를 쓸 수 있습니다. 회의는 녹음하거나 녹음 파일을 올려 회의록으로 남깁니다."
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
