import type { StaticImageData } from "next/image";
import arrowIcon from "../../../../svg/document/arrow.svg";
import chatIcon from "../../../../svg/agent/chat.svg";
import chatScrollIcon from "../../../../svg/agent/chat_scroll.svg";
import sendIcon from "../../../../svg/agent/send.svg";
import emptyChatIcon from "../../../../svg/agent/empty_chat.svg";
import chatCheckIcon from "../../../../svg/agent/chat_check.svg";
import claudeIcon from "../../../../svg/llm/claude.svg";
import geminiIcon from "../../../../svg/llm/gemini.svg";
import gptIcon from "../../../../svg/llm/gpt.svg";
import collectionIcon from "../../../../svg/navigation/menu_log.svg";
import conceptPageIcon from "../../../../svg/graph/conceptpage.svg";
import fileIcon from "../../../../svg/document/file.svg";
import fruitionLogo from "../../../../svg/brand/fruition-logo.svg";
import folderPlusIcon from "../../../../svg/navigation/menu_new.svg";
import graphSelectIcon from "../../../../svg/navigation/graph_select.svg";
import homeIcon from "../../../../svg/navigation/menu_home.svg";
import homeSelectIcon from "../../../../svg/navigation/home_select.svg";
import logSelectIcon from "../../../../svg/navigation/log_select.svg";
import rawPageIcon from "../../../../svg/graph/raw.svg";
import sideboxIcon from "../../../../svg/workspace/sidebox.svg";
import sourceIcon from "../../../../svg/document/source.svg";
import sourcePageIcon from "../../../../svg/graph/source_page.svg";
import shareIcon from "../../../../svg/navigation/menu_graph.svg";
import profileToggleIcon from "../../../../svg/workspace/profile_toggle.svg";
import toggleIcon from "../../../../svg/workspace/toggle.svg";
import listIcon from "../../../../svg/workspace/list.svg";
import userCircleIcon from "../../../../svg/workspace/UserCircle.svg";
import userCircleOutlineIcon from "../../../../svg/workspace/UserCircleOutline.svg";
import questionMarkIcon from "../../../../svg/common/QuestionMarkCircleOutline.svg";
import copyIcon from "../../../../svg/common/copy.svg";
import addFileIcon from "../../../../svg/common/plus.svg";
import computerIcon from "../../../../svg/device/computer.svg";
import phoneIcon from "../../../../svg/device/phone.svg";
import downloadIcon from "../../../../svg/common/download.svg";
import checkOnIcon from "../../../../svg/wiki/check_on.svg";
import ingestIcon from "../../../../svg/wiki/ingest.svg";
import refreshIcon from "../../../../svg/wiki/refresh.svg";

// svg 파일 없이 인라인 SVG로만 렌더링하는 아이콘 식별자
const bellIcon = { inlineIcon: "bell" } as const;

const lightningIcon = { inlineIcon: "lightning" } as const;
const menuSearchIcon = { inlineIcon: "menuSearch" } as const;
const plusIcon = { inlineIcon: "plus" } as const;
const settingIcon = { inlineIcon: "setting" } as const;
const settingScrollIcon = { inlineIcon: "settingScroll" } as const;
const skillBackIcon = { inlineIcon: "skillBack" } as const;

export type SvgAsset =
  | StaticImageData
  | typeof bellIcon
  | typeof lightningIcon
  | typeof menuSearchIcon
  | typeof plusIcon
  | typeof settingIcon
  | typeof settingScrollIcon
  | typeof skillBackIcon;

export {
  sendIcon,
  addFileIcon,
  arrowIcon,
  checkOnIcon,
  ingestIcon,
  refreshIcon,
  settingScrollIcon,
  skillBackIcon,
  userCircleOutlineIcon,
  questionMarkIcon,
  bellIcon,
  chatIcon,
  chatScrollIcon,
  emptyChatIcon,
  folderPlusIcon,
  graphSelectIcon,
  homeSelectIcon,
  logSelectIcon,
  menuSearchIcon,
  plusIcon,
  shareIcon,
  chatCheckIcon,
  claudeIcon,
  collectionIcon,
  geminiIcon,
  gptIcon,
  conceptPageIcon,
  fileIcon,
  fruitionLogo,
  homeIcon,
  lightningIcon,
  profileToggleIcon,
  rawPageIcon,
  sideboxIcon,
  sourceIcon,
  sourcePageIcon,
  settingIcon,
  toggleIcon,
  listIcon,
  copyIcon,
  downloadIcon,
  computerIcon,
  phoneIcon,
  userCircleIcon
};

