import type { ReactNode } from "react";
import type { StaticImageData } from "next/image";
import membersAsset from "@/shared/assets/svg/settings/nav-members.svg";
import securityAsset from "@/shared/assets/svg/settings/nav-security.svg";
import workspaceAsset from "@/shared/assets/svg/settings/nav-workspace.svg";
import { chatBubbleIcon, collectionIcon, lightningIcon, retryIcon, SvgIcon, type SvgAsset } from "@/shared/ui/SvgIcon";
import { RailArchiveIcon, RailIngestIcon, RailWorkIcon } from "@/widgets/rail-navigation/ui/RailIcons";
import type { LandingChipId } from "../model/landingContent";
import styles from "./LandingSections.module.css";

/*
 * 랜딩 기능 칩 아이콘. 모두 앱에 이미 있는 SVG 자산과 레일 아이콘을 쓰고 색은 currentColor(테마)를 따른다.
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

/** 칩 키(landingContent.ts의 LandingChipId) → 아이콘 */
export const CHIP_ICONS: Readonly<Record<LandingChipId, ReactNode>> = {
  meetingNotes: <Inline src={chatBubbleIcon} />,
  folders: <Rail><RailArchiveIcon className={styles["glyph-svg"]} /></Rail>,
  ingest: <Rail><RailIngestIcon className={styles["glyph-svg"]} /></Rail>,
  aiLog: <Inline src={collectionIcon} isPadded />,
  history: <Inline src={retryIcon} />,
  teamWorkspace: <Masked src={workspaceAsset} />,
  memberInvite: <Masked src={membersAsset} />,
  permissions: <Masked src={securityAsset} />,
  coEditing: <Rail><RailWorkIcon className={styles["glyph-svg"]} /></Rail>,
  teamSkills: <Inline src={lightningIcon} isPadded />
};
