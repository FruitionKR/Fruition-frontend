import { useEffect, useRef, useState } from "react";
import { hasOAuthLinkResult, useMe, useSignOut } from "@/entities/user";
import { SettingsModal } from "@/features/user-settings";
import { useDismissOnOutside } from "@/shared/lib/useDismissOnOutside";
import { RailButton } from "@/widgets/rail-navigation/ui/RailNavigation";
import { RailSettingIcon, RailUserIcon } from "@/widgets/rail-navigation/ui/RailIcons";
import styles from "./DocumentSidebar.module.css";

/**
 * 레일 하단 설정·프로필 버튼 (Figma 1512:15782 setting, 1512:15786 profile).
 * 톱니는 사용자 설정을 바로 열고, 프로필은 이름·로그아웃 메뉴를 오른쪽 위로 연다.
 */
export function SidebarProfile() {
  const { signOut } = useSignOut();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 설정에서 시작한 소셜 계정 연동을 마치고 돌아오면 결과를 보여 줄 설정(계정)을 다시 연다.
  useEffect(() => {
    if (hasOAuthLinkResult()) setIsSettingsOpen(true);
  }, []);

  // 표시용 데이터라 실패 시 fallback 이름을 유지한다.
  const { data: me } = useMe();
  const displayName = me ? me.display_name || me.email : null;

  useDismissOnOutside(rootRef, isMenuOpen, () => setIsMenuOpen(false));

  const name = displayName ?? "사용자";

  function openSettings() {
    setIsMenuOpen(false);
    setIsSettingsOpen(true);
  }

  return (
    <>
      <RailButton
        label="설정"
        onClick={(event) => {
          event.stopPropagation();
          openSettings();
        }}
      >
        <RailSettingIcon />
      </RailButton>

      <div className={styles["rail-popover-anchor"]} ref={rootRef}>
        <RailButton
          label={`프로필 메뉴 (${name})`}
          tooltip={name}
          aria-expanded={isMenuOpen}
          onClick={(event) => {
            event.stopPropagation();
            setIsMenuOpen((open) => !open);
          }}
        >
          <RailUserIcon />
        </RailButton>

        {isMenuOpen && (
          <div className={styles["profile-menu"]} role="menu" aria-label="프로필 메뉴">
            <div className={styles["profile-menu-user"]}>
              <strong>{name}</strong>
              <small>온라인</small>
            </div>
            <button type="button" role="menuitem" onClick={openSettings}>
              설정
            </button>
            <button type="button" role="menuitem" onClick={() => void signOut({ callLogout: true })}>
              로그아웃
            </button>
          </div>
        )}
      </div>

      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </>
  );
}
