"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  fetchAiModels,
  fetchWorkspaceAiModelSettings,
  isSameSelection,
  updateWorkspaceAiModelSettings,
  type AiModel,
  type AiModelSelection
} from "@/entities/ai";
import { useMe, useSignOut } from "@/entities/user";
import { useWorkspaceName } from "@/entities/workspace/model/useWorkspaceName";
import { getErrorMessage } from "@/shared/lib/errors";
import { useBackdropClick } from "@/shared/lib/useBackdropClick";
import { useEscapeKey } from "@/shared/lib/useEscapeKey";
import {
  bellIcon,
  plusIcon,
  settingIcon,
  SvgIcon,
  userCircleOutlineIcon
} from "@/shared/ui/SvgIcon";
import { AccountPanel } from "./panels/AccountPanel";
import { MembersPanel } from "./panels/MembersPanel";
import { NotificationsPanel } from "./panels/NotificationsPanel";
import { PreferencesPanel } from "./panels/PreferencesPanel";
import { ProfilePanel } from "./panels/ProfilePanel";
import { WorkspacePanel } from "./panels/WorkspacePanel";
import styles from "./SettingsModal.module.css";

export type SettingsSection = "profile" | "account" | "notifications" | "preferences" | "general" | "members";

/** 계정 설정 아이콘: 자물쇠 (24×24, 메뉴 아이콘과 같은 크기). */
function AccountIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 10.5V7.75C8.5 5.68 10.07 4 12 4C13.93 4 15.5 5.68 15.5 7.75V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 14.25V16.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** 워크스페이스 설정 아이콘: 네 칸 격자 (24×24). 톱니는 개인 기본 설정에 쓴다. */
function WorkspaceIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="4.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="4.5" y="13.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="13.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** 로그아웃 아이콘: 문틀 + 바깥으로 나가는 화살표 (24×24, 메뉴 아이콘과 같은 크기). */
function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M14 4H6.8C6.36 4 6 4.36 6 4.8V19.2C6 19.64 6.36 20 6.8 20H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M11 12H20M20 12L16.8 8.8M20 12L16.8 15.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 설정 메뉴 한 줄. 활성 섹션은 강조하고 aria-current로 알린다. */
function NavRow({
  isActive,
  ariaLabel,
  onClick,
  children
}: {
  isActive: boolean;
  ariaLabel?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${styles["nav-row"]} ${isActive ? styles["is-active"] : ""}`}
      aria-current={isActive ? "page" : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * 설정 모달 (Figma 963:8660 / 963:8257 / 771:18800). 스킬은 레일 "스킬" 화면으로 옮겼다.
 * initialSection: 레일 프로필은 프로필 설정, 톱니는 기본 설정으로 연다.
 */
export function SettingsModal({ onClose, initialSection = "profile" }: { onClose: () => void; initialSection?: SettingsSection }) {
  const workspaceName = useWorkspaceName();
  const { signOut } = useSignOut();
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const { data: me } = useMe();
  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [aiModelSelection, setAiModelSelection] = useState<AiModelSelection | null>(null);
  const [aiModelError, setAiModelError] = useState<string | null>(null);
  const [isAiModelSaving, setIsAiModelSaving] = useState(false);
  // PUT /ai-model-settings는 OWNER 전용이다. 설정 로드 전에는 안전하게 읽기 전용으로 둔다.
  const [canUpdateAiModel, setCanUpdateAiModel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAiModels()
      .then((models) => {
        if (!cancelled) setAiModels(models);
      })
      .catch((error: unknown) => {
        if (!cancelled) setAiModelError(getErrorMessage(error, "LLM Provider 목록을 불러오지 못했습니다."));
      });
    fetchWorkspaceAiModelSettings()
      .then((settings) => {
        if (cancelled) return;
        setAiModelSelection(settings.ingest_lint);
        setCanUpdateAiModel(settings.can_update === true);
      })
      .catch((error: unknown) => {
        if (!cancelled) setAiModelError(getErrorMessage(error, "LLM Provider 설정을 불러오지 못했습니다."));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEscapeKey(true, onClose);
  const backdropClick = useBackdropClick(onClose);

  const name = me?.display_name || "사용자";
  const wsName = workspaceName ?? "워크스페이스";

  async function selectAiModel(selected: AiModel) {
    if (!canUpdateAiModel || isSameSelection(selected, aiModelSelection) || isAiModelSaving) return;
    setIsAiModelSaving(true);
    setAiModelError(null);
    try {
      const settings = await updateWorkspaceAiModelSettings({
        provider: selected.provider,
        model: selected.model
      });
      setAiModelSelection(settings.ingest_lint);
      setCanUpdateAiModel(settings.can_update === true);
    } catch (error: unknown) {
      setAiModelError(getErrorMessage(error, "LLM Provider 설정을 저장하지 못했습니다."));
    } finally {
      setIsAiModelSaving(false);
    }
  }

  // 사이드바(z-index 스태킹 컨텍스트) 내부에 렌더되면 편집기 등에 가려지므로 body로 portal한다.
  return createPortal(
    <div className={styles.overlay} {...backdropClick}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="설정"
        onClick={(event) => event.stopPropagation()}
      >
        <nav className={styles.nav} aria-label="설정 메뉴">
          <div className={styles["nav-group"]}>
            <p className={styles["nav-label"]}>계정</p>
            {/* 프로필 설정: 메뉴 줄 자체가 프로필 사진(이니셜)과 닉네임을 보여 준다 */}
            <NavRow isActive={activeSection === "profile"} ariaLabel={`프로필 설정 (${name})`} onClick={() => setActiveSection("profile")}>
              <span className={styles["nav-avatar"]} aria-hidden>{name.charAt(0)}</span>
              <span>{name}</span>
            </NavRow>
            <NavRow isActive={activeSection === "account"} onClick={() => setActiveSection("account")}>
              <AccountIcon className={styles["nav-icon"]} />
              <span>계정 설정</span>
            </NavRow>
            <NavRow isActive={activeSection === "notifications"} onClick={() => setActiveSection("notifications")}>
              <SvgIcon src={bellIcon} className={styles["nav-icon"]} />
              <span>알림</span>
            </NavRow>
          </div>
          <div className={styles["nav-group"]}>
            <p className={styles["nav-label"]}>설정</p>
            <NavRow isActive={activeSection === "preferences"} onClick={() => setActiveSection("preferences")}>
              <SvgIcon src={settingIcon} className={styles["nav-icon"]} />
              <span>기본 설정</span>
            </NavRow>
            <NavRow isActive={activeSection === "general"} onClick={() => setActiveSection("general")}>
              <WorkspaceIcon className={styles["nav-icon"]} />
              <span>워크스페이스 설정</span>
            </NavRow>
            <NavRow isActive={activeSection === "members"} onClick={() => setActiveSection("members")}>
              <SvgIcon src={userCircleOutlineIcon} className={styles["nav-icon"]} />
              <span>멤버 관리</span>
            </NavRow>
          </div>
          {/* 계정 동작은 메뉴 맨 아래 구분선 뒤에 둔다 (디스코드 설정의 로그아웃 위치) */}
          <div className={styles["nav-footer"]}>
            <button
              type="button"
              className={`${styles["nav-row"]} ${styles["is-danger"]}`}
              onClick={() => void signOut({ callLogout: true })}
            >
              <LogoutIcon className={styles["nav-icon"]} />
              <span>로그아웃</span>
            </button>
          </div>
        </nav>

        <div className={styles.content}>
          {activeSection === "profile" && <ProfilePanel />}
          {activeSection === "account" && <AccountPanel />}
          {activeSection === "notifications" && <NotificationsPanel />}
          {activeSection === "preferences" && <PreferencesPanel />}
          {activeSection === "general" && (
            <WorkspacePanel
              wsName={wsName}
              aiModels={aiModels}
              aiModelSelection={aiModelSelection}
              aiModelError={aiModelError}
              isAiModelSaving={isAiModelSaving}
              canUpdateAiModel={canUpdateAiModel}
              onSelectModel={(model) => void selectAiModel(model)}
            />
          )}
          {activeSection === "members" && <MembersPanel />}
          <button type="button" className={styles.close} aria-label="설정 닫기" onClick={onClose}>
            <SvgIcon src={plusIcon} className={styles["close-icon"]} />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
