/** '/' 슬래시 메뉴 한글 라벨. 노트 편집기와 위키 페이지 편집기가 같은 메뉴 이름을 쓴다. */
export const SLASH_MENU_LABELS = {
  textGroup: {
    label: "텍스트",
    text: { label: "본문" },
    h1: { label: "제목 1" },
    h2: { label: "제목 2" },
    h3: { label: "제목 3" },
    // 본문과 같거나 작은 h4~h6은 만들지 않는다(model/headingInputRules.ts).
    h4: null,
    h5: null,
    h6: null,
    quote: { label: "인용" },
    divider: { label: "구분선" }
  },
  listGroup: {
    label: "목록",
    bulletList: { label: "글머리 기호 목록" },
    orderedList: { label: "번호 목록" },
    taskList: { label: "체크리스트" }
  },
  advancedGroup: {
    label: "고급",
    image: { label: "이미지" },
    codeBlock: { label: "코드 블록" },
    table: { label: "표" },
    math: { label: "수식" }
  }
} as const;

/** 빈 본문 안내 문구(Figma 426:2202). WYSIWYG·소스 모드가 같은 문구를 쓴다. */
export const NOTE_BODY_PLACEHOLDER = "'/'를 입력해 마크다운 기능을 사용하거나 내용을 입력하세요";
