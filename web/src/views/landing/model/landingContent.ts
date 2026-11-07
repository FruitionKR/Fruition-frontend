/**
 * 랜딩 화면 구조. 히어로 → 시연 영상 3묶음 → 함께하기 → 문서 보호 → FAQ → 마지막 안내 순서다.
 * 문구는 언어별 메시지(src/shared/i18n/messages/{ko,en}/landing.json)에 있고, 여기에는 순서·키·영상만 둔다.
 * 함께하기 문구와 기능 칩의 한국어는 사용자가 정한 문구를 그대로 쓴다(영어 부제·괄호 병기 포함).
 */

import type { LandingVideoId } from "./landingVideos";

export interface LandingNavItem {
  readonly href: "#data-handling";
  /** landing.nav 아래 메시지 키. 메뉴가 가리키는 섹션의 h2로도 쓴다. */
  readonly key: "dataHandling";
}

export const LANDING_NAV: readonly LandingNavItem[] = [{ href: "#data-handling", key: "dataHandling" }];

/** 기능 칩. landing.chips 아래 메시지 키이고 LandingIcons.tsx의 아이콘 키다. */
export type LandingChipId =
  | "meetingNotes"
  | "folders"
  | "ingest"
  | "aiLog"
  | "history"
  | "teamWorkspace"
  | "memberInvite"
  | "permissions"
  | "coEditing"
  | "teamSkills";

/** 영상으로 다루지 않는 협업 소개. 문구는 landing.together 아래에 있다. */
export const LANDING_TOGETHER = {
  english: "BUILD TOGETHER",
  chips: ["teamWorkspace", "memberInvite", "permissions", "coEditing", "teamSkills"]
} as const satisfies { english: string; chips: readonly LandingChipId[] };

export interface LandingDemoSlot {
  /** landing.demo.slots 아래 메시지 키(제목·설명) */
  readonly id: "upload" | "connect-ask" | "edit-skill";
  readonly index: string;
  readonly english: string;
  /** 차례로 보여 줄 시연 영상. 영상 제목·설명은 landing.videos 아래에 있다. */
  readonly steps: readonly LandingVideoId[];
  /** 영상에 나오지 않지만 이 묶음에 속하는 기능 */
  readonly chips: readonly LandingChipId[];
}

/** 시연 흐름: 올리기 → 편입·질의 → AI 편집·스킬. 묶음마다 기능별 시연 영상을 차례로 보여 주며 프로젝트를 설명한다. */
export const LANDING_DEMO_SLOTS: readonly LandingDemoSlot[] = [
  {
    id: "upload",
    index: "01",
    english: "UPLOAD & WRITE",
    steps: ["pdf-upload", "document-editor"],
    chips: ["meetingNotes", "folders"]
  },
  {
    id: "connect-ask",
    index: "02",
    english: "INGEST & ASK",
    steps: ["wiki-ingest", "wiki-lint", "query"],
    chips: ["ingest", "aiLog", "history"]
  },
  {
    id: "edit-skill",
    index: "03",
    english: "EDIT & SKILL",
    steps: ["ai-edit", "skill-create", "skill-run"],
    chips: []
  }
];

/** "기능 둘러보기"와 건너뛰기 링크가 가리키는 첫 영상 묶음 */
export const LANDING_FIRST_DEMO_ANCHOR = `#demo-${LANDING_DEMO_SLOTS[0].id}`;

/** FAQ 순서. landing.faq.items 아래 메시지 키다. */
export const LANDING_FAQ = ["difference", "sources", "ingest", "availability"] as const;
