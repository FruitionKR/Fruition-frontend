"use client";

import styles from "@/features/agent-chat/ui/AgentChat.module.css";
import { cx } from "@/shared/lib/classNames";
import { chatLauncherIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { useTranslations } from "next-intl";

/**
 * 채팅 패널이 닫혀 있을 때 콘텐츠 우하단에 뜨는 패널 열기 버튼 (Figma 1571:26741 chat_ver, 48px 원형).
 * 아이콘(agent/chat-launcher.svg)이 파란 원과 말풍선을 모두 담고 있어 버튼 자체는 배경 없이 그림자만 준다.
 */
export function AgentLauncher({ onOpen, isAvoidingProposals = false }: {
  onOpen: () => void;
  /** 본문의 제안 버튼이 오른쪽에 붙는 동안 휴대폰에서는 왼쪽으로 비켜 선다. */
  isAvoidingProposals?: boolean;
}) {
  const t = useTranslations("agentChat");
  return (
    <button type="button" className={cx(styles["agent-launcher"], isAvoidingProposals && styles["is-avoiding-proposals"])} aria-label={t("panel.open")} onClick={onOpen}>
      <SvgIcon src={chatLauncherIcon} className={styles["agent-launcher-icon"]} />
    </button>
  );
}
