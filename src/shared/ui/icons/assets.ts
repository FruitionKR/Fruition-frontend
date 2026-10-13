import type { StaticImageData } from "next/image";
import emptyChatIcon from "@/shared/assets/svg/agent/empty_chat.svg";
import claudeIcon from "@/shared/assets/svg/llm/claude.svg";
import geminiIcon from "@/shared/assets/svg/llm/gemini.svg";
import gptIcon from "@/shared/assets/svg/llm/gpt.svg";
import collectionIcon from "@/shared/assets/svg/navigation/menu_log.svg";
import fileIcon from "@/shared/assets/svg/document/file.svg";
import fruitionLogo from "@/shared/assets/svg/brand/fruition-logo.svg";
import graphSelectIcon from "@/shared/assets/svg/navigation/graph_select.svg";
import homeIcon from "@/shared/assets/svg/navigation/menu_home.svg";
import homeSelectIcon from "@/shared/assets/svg/navigation/home_select.svg";
import logSelectIcon from "@/shared/assets/svg/navigation/log_select.svg";
import sidebarToggleIcon from "@/shared/assets/svg/workspace/sidebar_toggle.svg";
import sourceIcon from "@/shared/assets/svg/document/source.svg";
import shareIcon from "@/shared/assets/svg/navigation/menu_graph.svg";
import userCircleIcon from "@/shared/assets/svg/workspace/UserCircle.svg";
import userCircleOutlineIcon from "@/shared/assets/svg/workspace/UserCircleOutline.svg";
import questionMarkIcon from "@/shared/assets/svg/common/QuestionMarkCircleOutline.svg";
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
const settingScrollIcon = { inlineIcon: "settingScroll" } as const;
const skillBackIcon = { inlineIcon: "skillBack" } as const;
const moreIcon = { inlineIcon: "more" } as const;
const retryIcon = { inlineIcon: "retry" } as const;

export type SvgAsset =
  | StaticImageData
  | typeof bellIcon
  | typeof lightningIcon
  | typeof menuSearchIcon
  | typeof plusIcon
  | typeof settingIcon
  | typeof settingScrollIcon
  | typeof skillBackIcon
  | typeof moreIcon
  | typeof retryIcon;

export {
  settingScrollIcon,
  skillBackIcon,
  moreIcon,
  retryIcon,
  userCircleOutlineIcon,
  questionMarkIcon,
  bellIcon,
  emptyChatIcon,
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

