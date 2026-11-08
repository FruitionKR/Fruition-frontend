import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { UserAvatar, hasOAuthLinkResult, useMe } from "@/entities/user";
import { TutorialDialog, useTutorialDialog } from "@/features/tutorial";
import { RailButton } from "@/widgets/rail-navigation/ui/RailNavigation";
import railStyles from "@/widgets/rail-navigation/ui/RailNavigation.module.css";
import { RailHelpIcon, RailSettingIcon, RailUserIcon } from "@/widgets/rail-navigation/ui/RailIcons";
import type { SettingsSection } from "@/widgets/workspace/lib/workspaceLocation";

/**
 * 레일 하단 사용 방법·설정·프로필 버튼 (Figma 1540:17964 setting, 1540:17968 profile).
 * 톱니 바로 위 `?`는 서비스 사용 방법 튜토리얼 모달을 연다. 휴대폰 아래 탭 바에도 남는다.
 * 톱니는 디스플레이를, 프로필은 사용자 설정을 설정 화면(Figma 1540:22452)으로 연다. 로그아웃은 설정 메뉴 맨 아래에 있다.
 */
export function SidebarProfile({
  isActive = false,
  onOpenSettings
}: {
  /** 설정 화면이 열려 있는지. 톱니를 활성 상태로 그린다. */
  isActive?: boolean;
  onOpenSettings: (section: SettingsSection) => void;
}) {
  const t = useTranslations("documents.sidebar");
  const tTutorial = useTranslations("tutorial.ui");
  const tutorial = useTutorialDialog();
  // 설정에서 시작한 소셜 계정 연동을 마치고 돌아오면 결과를 보여 줄 사용자 설정(연동된 계정)을 다시 연다.
  useEffect(() => {
    if (hasOAuthLinkResult()) onOpenSettings("profile");
    // 마운트 때 한 번만 확인한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 표시용 데이터라 실패 시 fallback 이름을 유지한다.
  const { data: me } = useMe();
  const name = (me ? me.display_name || me.email : null) ?? t("defaultUserName");

  return (
    <>
      <RailButton
        label={tTutorial("open")}
        // 휴대폰 아래 탭은 칸이 좁아(7칸) 짧은 이름을 쓴다. 읽어 주는 이름은 label 그대로다.
        phoneLabel={tTutorial("openShort")}
        aria-haspopup="dialog"
        aria-expanded={tutorial.isOpen}
        onClick={(event) => {
          event.stopPropagation();
          // Safari는 클릭으로 버튼에 포커스를 주지 않아, 닫을 때 이 버튼으로 돌아오도록 먼저 포커스를 둔다.
          event.currentTarget.focus();
          tutorial.open();
        }}
      >
        <RailHelpIcon />
      </RailButton>
      {tutorial.isOpen && <TutorialDialog onClose={tutorial.close} />}

      <RailButton
        label={t("settings")}
        phoneLabel={t("settings")}
        isActive={isActive}
        aria-current={isActive ? "page" : undefined}
        onClick={(event) => {
          event.stopPropagation();
          onOpenSettings("preferences");
        }}
      >
        <RailSettingIcon />
      </RailButton>

      <RailButton
        label={t("profile", { name })}
        tooltip={name}
        className={railStyles["rail-profile"]}
        onClick={(event) => {
          event.stopPropagation();
          onOpenSettings("profile");
        }}
      >
        {/* 프로필 사진이 있으면 사진, 없으면 기본 사용자 아이콘 */}
        {me?.avatar_url ? <UserAvatar avatarUrl={me.avatar_url} name={name} className={railStyles["rail-avatar"]} /> : <RailUserIcon />}
      </RailButton>
    </>
  );
}
