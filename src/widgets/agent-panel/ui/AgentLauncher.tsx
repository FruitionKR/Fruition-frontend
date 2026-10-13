"use client";

import styles from "@/features/agent-chat/ui/AgentChat.module.css";
import { chatLauncherIcon, SvgIcon } from "@/shared/ui/SvgIcon";

/**
 * 채팅 패널이 닫혀 있을 때 콘텐츠 우하단에 뜨는 패널 열기 버튼 (Figma 1571:26741 chat_ver, 48px 원형).
 * 아이콘(agent/chat_launcher.svg)이 파란 원과 말풍선을 모두 담고 있어 버튼 자체는 배경 없이 그림자만 준다.
 */
export function AgentLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className={styles["agent-launcher"]} aria-label="AI 에이전트 패널 열기" onClick={onOpen}>
      <SvgIcon src={chatLauncherIcon} className={styles["agent-launcher-icon"]} />
    </button>
  );
}
