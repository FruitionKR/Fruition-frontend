"use client";

import { useEffect, useState } from "react";
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
import { cx } from "@/shared/lib/classNames";
import { bellIcon, settingIcon, SvgIcon, userCircleOutlineIcon } from "@/shared/ui/SvgIcon";
import type { SettingsSection } from "@/widgets/workspace/lib/workspaceLocation";
import { AccountPanel } from "./panels/AccountPanel";
import { MembersPanel } from "./panels/MembersPanel";
import { NotificationsPanel } from "./panels/NotificationsPanel";
import { PreferencesPanel } from "./panels/PreferencesPanel";
import { ProfilePanel } from "./panels/ProfilePanel";
import { WorkspacePanel } from "./panels/WorkspacePanel";
import styles from "./SettingsModal.module.css";

export type { SettingsSection };

/** 계정 보안 아이콘: 열린 자물쇠 (Figma 1577:3579 LockOpenOutline, 24×24). */
function LockIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 10.5V7.75C8.5 5.68 10.07 4 12 4C13.93 4 15.5 5.68 15.5 7.75V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 14.25V16.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** 워크스페이스 설정 아이콘: 네 칸 격자 (24×24). 톱니는 디스플레이(개인 기본 설정)에 쓴다. */
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

/** 디스플레이 아이콘: 모니터 (Figma 1577:3539, 24×24). */
function DisplayIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="4.05" y="5.9" width="15.9" height="12" rx="2.1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.5 17.2H21.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function NavRow({
  section,
  activeSection,
  onSelect,
  label,
  children
}: {
  section: SettingsSection;
  activeSection: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  label?: string;
  children: React.ReactNode;
}) {
  const isActive = activeSection === section;
  return (
    <button
      type="button"
      className={cx(styles["nav-row"], isActive && styles["is-active"])}
      aria-current={isActive ? "page" : undefined}
      aria-label={label}
      onClick={() => onSelect(section)}
    >
      {children}
    </button>
  );
}

/**
 * 설정 화면의 왼쪽 메뉴 (Figma 1540:22452 SNB). 사이드바의 문서 트리 자리에 들어간다.
 * 계정: 사용자 설정·계정 보안·알림 설정 / 설정: 워크스페이스 설정·디스플레이·멤버 관리. 로그아웃은 맨 아래.
 */
export function SettingsNav({
  activeSection,
  onSelect
}: {
  activeSection: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  const { signOut } = useSignOut();
  const { data: me } = useMe();
  const name = me?.display_name || "사용자";

  return (
    <nav className={styles.nav} aria-label="설정 메뉴">
      <div className={styles["nav-group"]}>
        <p className={styles["nav-label"]}>계정</p>
        {/* 사용자 설정: 프로필 사진(이니셜)을 아이콘 자리에 보여 준다 */}
        <NavRow section="profile" activeSection={activeSection} onSelect={onSelect} label={`사용자 설정 (${name})`}>
          <span className={styles["nav-avatar"]} aria-hidden>{name.charAt(0)}</span>
          <span>사용자 설정</span>
        </NavRow>
        <NavRow section="account" activeSection={activeSection} onSelect={onSelect}>
          <LockIcon className={styles["nav-icon"]} />
          <span>계정 보안</span>
        </NavRow>
        <NavRow section="notifications" activeSection={activeSection} onSelect={onSelect}>
          <SvgIcon src={bellIcon} className={styles["nav-icon"]} />
          <span>알림 설정</span>
        </NavRow>
      </div>
      <div className={styles["nav-group"]}>
        <p className={styles["nav-label"]}>설정</p>
        <NavRow section="general" activeSection={activeSection} onSelect={onSelect}>
          <WorkspaceIcon className={styles["nav-icon"]} />
          <span>워크스페이스 설정</span>
        </NavRow>
        <NavRow section="preferences" activeSection={activeSection} onSelect={onSelect}>
          <DisplayIcon className={styles["nav-icon"]} />
          <span>디스플레이</span>
        </NavRow>
        <NavRow section="members" activeSection={activeSection} onSelect={onSelect}>
          <SvgIcon src={userCircleOutlineIcon} className={styles["nav-icon"]} />
          <span>멤버 관리</span>
        </NavRow>
      </div>
      {/* 계정 동작은 메뉴 맨 아래 구분선 뒤에 둔다 (디스코드 설정의 로그아웃 위치) */}
      <div className={styles["nav-footer"]}>
        <button
          type="button"
          className={cx(styles["nav-row"], styles["is-danger"])}
          onClick={() => void signOut({ callLogout: true })}
        >
          <LogoutIcon className={styles["nav-icon"]} />
          <span>로그아웃</span>
        </button>
      </div>
    </nav>
  );
}

/** 설정 화면 본문 (Figma 1540:22452 container). 레일 설정 화면의 메인 영역을 채운다. */
export function SettingsContent({ section }: { section: SettingsSection }) {
  const workspaceName = useWorkspaceName();
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

  return (
    <section className={styles.view} aria-label="설정">
      <div className={styles.content}>
        {section === "profile" && <ProfilePanel />}
        {section === "account" && <AccountPanel />}
        {section === "notifications" && <NotificationsPanel />}
        {section === "preferences" && <PreferencesPanel />}
        {section === "general" && (
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
        {section === "members" && <MembersPanel />}
      </div>
    </section>
  );
}
