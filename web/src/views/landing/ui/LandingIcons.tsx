import type { ReactNode } from "react";
import type { StaticImageData } from "next/image";
import taskAcceptAsset from "@/shared/assets/svg/agent/task-accept.svg";
import fileAsset from "@/shared/assets/svg/document/file-outline.svg";
import sourceAsset from "@/shared/assets/svg/document/source-document.svg";
import membersAsset from "@/shared/assets/svg/settings/nav-members.svg";
import securityAsset from "@/shared/assets/svg/settings/nav-security.svg";
import workspaceAsset from "@/shared/assets/svg/settings/nav-workspace.svg";
import userOutlineAsset from "@/shared/assets/svg/workspace/user-circle-outline.svg";
import {
  chatBubbleIcon,
  collectionIcon,
  lightningIcon,
  menuSearchIcon,
  retryIcon,
  shareIcon,
  SvgIcon,
  type SvgAsset
} from "@/shared/ui/SvgIcon";
import {
  RailArchiveIcon,
  RailIngestIcon,
  RailRefreshIcon,
  RailWorkIcon
} from "@/widgets/rail-navigation/ui/RailIcons";
import type { LandingChapterId } from "../model/landingContent";
import styles from "./LandingSections.module.css";

/*
 * 랜딩 장 카드·기능 칩 아이콘. 모두 앱에 이미 있는 SVG 자산과 레일 아이콘을 쓰고 색은 currentColor(테마)를 따른다.
 * - 인라인 아이콘 가운데 36×36 캔버스(가운데 16px 글리프)는 data-pad로 크게 그려 글리프 크기를 맞춘다.
 * - 정적 SVG 파일은 모양(mask)으로만 써서 currentColor로 칠한다.
 */

function Inline({ src, isPadded = false }: { src: SvgAsset; isPadded?: boolean }) {
  return (
    <span className={styles["glyph"]} data-pad={isPadded || undefined}>
      <SvgIcon src={src} className={styles["glyph-svg"]} />
    </span>
  );
}

function Masked({ src }: { src: StaticImageData }) {
  const mask = `url(${src.src})`;
  return <span className={styles["glyph-mask"]} style={{ maskImage: mask, WebkitMaskImage: mask }} />;
}

function Rail({ children, isPadded = false }: { children: ReactNode; isPadded?: boolean }) {
  return (
    <span className={styles["glyph"]} data-pad={isPadded || undefined}>
      {children}
    </span>
  );
}

export const CHAPTER_ICONS: Record<LandingChapterId, ReactNode> = {
  capture: <Rail><RailIngestIcon className={styles["glyph-svg"]} /></Rail>,
  connect: <Inline src={shareIcon} isPadded />,
  discover: <Inline src={chatBubbleIcon} />,
  together: <Masked src={userOutlineAsset} />
};

/** 칩 문구 → 아이콘. 문구는 landingContent.ts의 chips와 같아야 한다(없으면 아이콘 없이 그린다). */
export const CHIP_ICONS: Readonly<Record<string, ReactNode>> = {
  "문서 업로드": <Rail><RailIngestIcon className={styles["glyph-svg"]} /></Rail>,
  "PDF Markdown으로 변환": <Rail isPadded><RailRefreshIcon className={styles["glyph-svg"]} /></Rail>,
  "Markdown 편집": <Masked src={fileAsset} />,
  "회의 받아쓰기 및 AI 회의록": <Inline src={chatBubbleIcon} />,
  "폴더 관리": <Rail><RailArchiveIcon className={styles["glyph-svg"]} /></Rail>,
  "문서와 채팅 위키 편입(Ingest)": <Rail><RailIngestIcon className={styles["glyph-svg"]} /></Rail>,
  "지식 그래프(Graph)": <Inline src={shareIcon} isPadded />,
  "지식 품질 검사(Lint)": <Masked src={taskAcceptAsset} />,
  "AI 로그 이력": <Inline src={collectionIcon} isPadded />,
  "롤백(History)": <Inline src={retryIcon} />,
  "자연어 질의응답(Query)": <Inline src={menuSearchIcon} isPadded />,
  "답변 근거 확인": <Masked src={sourceAsset} />,
  "AI 문서 편집(Edit)": <Masked src={fileAsset} />,
  "스킬 생성 및 실행(Skill)": <Inline src={lightningIcon} isPadded />,
  "팀 워크스페이스": <Masked src={workspaceAsset} />,
  "멤버 초대": <Masked src={membersAsset} />,
  "권한 관리": <Masked src={securityAsset} />,
  "안전한 공동 편집": <Rail><RailWorkIcon className={styles["glyph-svg"]} /></Rail>,
  "팀 스킬 공유": <Inline src={lightningIcon} isPadded />
};
