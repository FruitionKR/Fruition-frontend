import type { StaticImageData } from "next/image";
import chatBubbleIcon from "@/shared/assets/svg/agent/chat-bubble.svg";
import chatLauncherIcon from "@/shared/assets/svg/agent/chat-launcher.svg";
import claudeIcon from "@/shared/assets/svg/llm/claude.svg";
import geminiIcon from "@/shared/assets/svg/llm/gemini.svg";
import gptIcon from "@/shared/assets/svg/llm/gpt.svg";
import collectionIcon from "@/shared/assets/svg/navigation/log.svg";
import fileIcon from "@/shared/assets/svg/document/file-outline.svg";
import fruitionLogo from "@/shared/assets/svg/brand/fruition-logo.svg";
import graphSelectIcon from "@/shared/assets/svg/navigation/graph-active.svg";
import homeIcon from "@/shared/assets/svg/navigation/home.svg";
import homeSelectIcon from "@/shared/assets/svg/navigation/home-active.svg";
import logSelectIcon from "@/shared/assets/svg/navigation/log-active.svg";
import sidebarToggleIcon from "@/shared/assets/svg/workspace/sidebar-toggle.svg";
import sourceIcon from "@/shared/assets/svg/document/source-document.svg";
import shareIcon from "@/shared/assets/svg/navigation/graph.svg";
import userCircleIcon from "@/shared/assets/svg/workspace/user-circle-filled.svg";
import userCircleOutlineIcon from "@/shared/assets/svg/workspace/user-circle-outline.svg";
import questionMarkIcon from "@/shared/assets/svg/common/question-circle-outline.svg";
import copyIcon from "@/shared/assets/svg/common/copy.svg";
import computerIcon from "@/shared/assets/svg/device/computer.svg";
import phoneIcon from "@/shared/assets/svg/device/phone.svg";
import downloadIcon from "@/shared/assets/svg/common/download.svg";

// svg 파일 없이 인라인 SVG로만 렌더링하는 아이콘 식별자
const bellIcon = { inlineIcon: "bell" } as const;

const lightningIcon = { inlineIcon: "lightning" } as const;
const menuSearchIcon = { inlineIcon: "menuSearch" } as const;
const plusIcon = { inlineIcon: "plus" } as const;
const settingIcon = { inlineIcon: "setting" } as const;
const chevronDownSmallIcon = { inlineIcon: "settingScroll" } as const;
const chevronLeftSmallIcon = { inlineIcon: "skillBack" } as const;
const moreIcon = { inlineIcon: "more" } as const;
const retryIcon = { inlineIcon: "retry" } as const;

export type SvgAsset =
  | StaticImageData
  | typeof bellIcon
  | typeof lightningIcon
  | typeof menuSearchIcon
  | typeof plusIcon
  | typeof settingIcon
  | typeof chevronDownSmallIcon
  | typeof chevronLeftSmallIcon
  | typeof moreIcon
  | typeof retryIcon;

export {
  chevronDownSmallIcon,
  chevronLeftSmallIcon,
  moreIcon,
  retryIcon,
  userCircleOutlineIcon,
  questionMarkIcon,
  bellIcon,
  chatBubbleIcon,
  chatLauncherIcon,
  graphSelectIcon,
  homeSelectIcon,
  logSelectIcon,
  menuSearchIcon,
  plusIcon,
  shareIcon,
  claudeIcon,
  collectionIcon,
  geminiIcon,
  gptIcon,
  fileIcon,
  fruitionLogo,
  homeIcon,
  lightningIcon,
  sidebarToggleIcon,
  sourceIcon,
  settingIcon,
  copyIcon,
  downloadIcon,
  computerIcon,
  phoneIcon,
  userCircleIcon
};

