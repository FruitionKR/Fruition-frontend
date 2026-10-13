"use client";

import { MessageCircleMore } from "lucide-react";
import styles from "@/features/agent-chat/ui/AgentChat.module.css";

/**
 * 채팅 패널이 닫혀 있을 때 콘텐츠 우하단에 뜨는 패널 열기 버튼 (Figma 1426:15877 / 1406:14202 logo 자리).
 * 파형 마크는 입력창의 음성 버튼이 쓰므로, 열기 버튼은 채팅임이 바로 보이도록 말풍선 아이콘을 쓴다.
 */
export function AgentLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className={styles["agent-launcher"]} aria-label="AI 에이전트 패널 열기" onClick={onOpen}>
      <MessageCircleMore size={22} strokeWidth={2} aria-hidden />
    </button>
  );
}
