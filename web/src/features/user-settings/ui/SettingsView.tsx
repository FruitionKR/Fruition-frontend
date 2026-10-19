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
import { UserAvatar, useMe, useSignOut } from "@/entities/user";
import { useWorkspaceName } from "@/entities/workspace/model/useSelectedWorkspace";
import { getSelectedWorkspaceId, setSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { cx } from "@/shared/lib/classNames";
import Image, { type StaticImageData } from "next/image";
import navBellIcon from "@/shared/assets/svg/settings/nav-bell.svg";
import navDisplayIcon from "@/shared/assets/svg/settings/nav-display.svg";
import navMembersIcon from "@/shared/assets/svg/settings/nav-members.svg";
import navSecurityIcon from "@/shared/assets/svg/settings/nav-security.svg";
import navWorkspaceIcon from "@/shared/assets/svg/settings/nav-workspace.svg";
import type { SettingsSection } from "@/widgets/workspace/lib/workspaceLocation";
import { saveSettingsResume, type SettingsResume } from "../lib/settingsResume";
import { AccountPanel } from "./panels/AccountPanel";
import { DocumentsPanel } from "./panels/DocumentsPanel";
import { MembersPanel } from "./panels/MembersPanel";
import { NotificationsPanel } from "./panels/NotificationsPanel";
import { PreferencesPanel } from "./panels/PreferencesPanel";
import { ProfilePanel } from "./panels/ProfilePanel";
import { WorkspacePanel } from "./panels/WorkspacePanel";
import styles from "./SettingsModal.module.css";

export type { SettingsSection };

/** 휴지통(문서 관리) 아이콘: 접힌 모서리가 있는 문서 (24×24). */
function DocumentsIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M7 3.8H13.6L18.5 8.7V19.2C18.5 19.75 18.05 20.2 17.5 20.2H7C6.45 20.2 6 19.75 6 19.2V4.8C6 4.25 6.45 3.8 7 3.8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M13.6 3.8V8.7H18.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12.5H15.5M9 15.75H15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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

/** Figma SNB(1577:3242) 메뉴 아이콘: 24px 칸 가운데에 Figma 자산을 원래 크기로 둔다. */
function NavIcon({ src }: { src: StaticImageData }) {
  return (
    <span className={styles["nav-icon"]} aria-hidden>
      <Image src={src} alt="" />
    </span>
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
 * 설정 화면의 왼쪽 메뉴 (Figma 1577:3242 SNB). 사이드바의 문서 트리 자리에 들어간다.
 * 계정: 사용자 설정·계정 보안·알림 설정 / 설정: 워크스페이스 설정·디스플레이 설정·멤버 관리.
 * 휴지통과 로그아웃은 시안에 없지만 다른 진입점이 없어 시안 항목 뒤에 남긴다.
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
        {/* 사용자 설정: 프로필 사진(없으면 이니셜)을 아이콘 자리에 보여 준다 */}
        <NavRow section="profile" activeSection={activeSection} onSelect={onSelect} label={`사용자 설정 (${name})`}>
          <UserAvatar avatarUrl={me?.avatar_url} name={name} className={styles["nav-avatar"]} />
          <span>사용자 설정</span>
        </NavRow>
        <NavRow section="account" activeSection={activeSection} onSelect={onSelect}>
          <NavIcon src={navSecurityIcon} />
          <span>계정 보안</span>
        </NavRow>
        <NavRow section="notifications" activeSection={activeSection} onSelect={onSelect}>
          <NavIcon src={navBellIcon} />
          <span>알림 설정</span>
        </NavRow>
      </div>
      <div className={styles["nav-group"]}>
        <p className={styles["nav-label"]}>설정</p>
        <NavRow section="general" activeSection={activeSection} onSelect={onSelect}>
          <NavIcon src={navWorkspaceIcon} />
          <span>워크스페이스 설정</span>
        </NavRow>
        <NavRow section="preferences" activeSection={activeSection} onSelect={onSelect}>
          <NavIcon src={navDisplayIcon} />
          <span>디스플레이 설정</span>
        </NavRow>
        <NavRow section="members" activeSection={activeSection} onSelect={onSelect}>
          <NavIcon src={navMembersIcon} />
          <span>멤버 관리</span>
        </NavRow>
        <NavRow section="documents" activeSection={activeSection} onSelect={onSelect}>
          <DocumentsIcon className={styles["nav-icon"]} />
          <span>휴지통</span>
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

/**
 * 설정 화면 본문 (Figma 1540:22452 container). 레일 설정 화면의 메인 영역을 채운다.
 * resume: 소셜 재로그인·워크스페이스 전환 뒤 돌아와 탈퇴 확인 단계(account-delete)나 이메일 변경 창(email-change)을 다시 연다.
 */
export function SettingsContent({
  section,
  resume = null,
  onOpenSection
}: {
  section: SettingsSection;
  /** 오리진을 벗어났다 돌아온 뒤 다시 열 위치. HomeWorkspace가 section도 그에 맞춰 연다. */
  resume?: SettingsResume | null;
  onOpenSection: (section: SettingsSection) => void;
}) {
  const workspaceName = useWorkspaceName();

  /** 탈퇴가 막힌 워크스페이스의 멤버 관리로 간다. 다른 워크스페이스면 전환 후 새로 그려 멤버 관리를 다시 연다. */
  function openMembers(workspaceId: string) {
    if (workspaceId === getSelectedWorkspaceId()) {
      onOpenSection("members");
      return;
    }
    setSelectedWorkspaceId(workspaceId);
    saveSettingsResume("members");
    window.location.reload();
  }
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
        {section === "profile" && <ProfilePanel resumeEmailChange={resume === "email-change"} />}
        {section === "account" && (
          <AccountPanel resumeAccountDelete={resume === "account-delete"} onOpenMembers={openMembers} />
        )}
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
        {section === "documents" && <DocumentsPanel />}
      </div>
    </section>
  );
}
