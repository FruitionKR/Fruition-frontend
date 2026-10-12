import { useEffect, useState } from "react";
import { hasOAuthLinkResult, useMe } from "@/entities/user";
import { SettingsModal, type SettingsSection } from "@/features/user-settings";
import { RailButton } from "@/widgets/rail-navigation/ui/RailNavigation";
import { RailSettingIcon, RailUserIcon } from "@/widgets/rail-navigation/ui/RailIcons";

/**
 * 레일 하단 설정·프로필 버튼 (Figma 1540:17964 setting, 1540:17968 profile).
 * 톱니는 기본 설정을, 프로필은 프로필 설정을 바로 연다. 로그아웃은 설정 메뉴 맨 아래에 있다.
 */
export function SidebarProfile() {
  // 열린 설정 화면. null이면 닫혀 있다.
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);

  // 설정에서 시작한 소셜 계정 연동을 마치고 돌아오면 결과를 보여 줄 설정(계정)을 다시 연다.
  useEffect(() => {
    if (hasOAuthLinkResult()) setSettingsSection("account");
  }, []);

  // 표시용 데이터라 실패 시 fallback 이름을 유지한다.
  const { data: me } = useMe();
  const name = (me ? me.display_name || me.email : null) ?? "사용자";

  return (
    <>
      <RailButton
        label="설정"
        onClick={(event) => {
          event.stopPropagation();
          setSettingsSection("preferences");
        }}
      >
        <RailSettingIcon />
      </RailButton>

      <RailButton
        label={`프로필 설정 (${name})`}
        tooltip={name}
        onClick={(event) => {
          event.stopPropagation();
          setSettingsSection("profile");
        }}
      >
        <RailUserIcon />
      </RailButton>

      {settingsSection && (
        <SettingsModal key={settingsSection} initialSection={settingsSection} onClose={() => setSettingsSection(null)} />
      )}
    </>
  );
}
