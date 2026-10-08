import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { hasOAuthLinkResult, useMe, useSignOut } from "@/entities/user";
import { SettingsModal } from "@/features/user-settings";
import { useDismissOnOutside } from "@/shared/lib/useDismissOnOutside";
import { SvgIcon, userCircleIcon } from "@/shared/ui/SvgIcon";
import styles from "./DocumentSidebar.module.css";

/** 사이드바 하단 프로필 푸터 (Figma 747:6648): 점 세 개 버튼 클릭 시 설정/로그아웃 메뉴를 연다. */
export function SidebarProfile() {
  const { signOut } = useSignOut();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  // 설정에서 시작한 소셜 계정 연동을 마치고 돌아오면 결과를 보여 줄 설정(계정)을 다시 연다.
  useEffect(() => {
    if (hasOAuthLinkResult()) setIsSettingsOpen(true);
  }, []);

  // 표시용 데이터라 실패 시 fallback 이름을 유지한다.
  const { data: me } = useMe();
  const displayName = me ? me.display_name || me.email : null;

  useDismissOnOutside(rootRef, isMenuOpen, () => setIsMenuOpen(false));

  const name = displayName ?? "사용자";

  return (
    <footer className={styles["sidebar-profile"]} ref={rootRef}>
      <div className={styles["sidebar-profile-row"]}>
        {/* 프로필 이미지·이름을 누르면 메뉴를 거치지 않고 사용자 설정을 바로 연다. */}
        <button
          type="button"
          className={styles["sidebar-profile-user"]}
          aria-label="사용자 설정 열기"
          onClick={() => {
            setIsMenuOpen(false);
            setIsSettingsOpen(true);
          }}
        >
          <SvgIcon src={userCircleIcon} className={styles["sidebar-profile-avatar"]} />
          <span className={styles["sidebar-profile-info"]}>
            <strong>{name}</strong>
            <small>온라인</small>
          </span>
        </button>
        <button
          type="button"
          className={styles["sidebar-profile-toggle"]}
          aria-label="프로필 메뉴"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          {/* 채팅 옵션(AgentHeader)과 같은 점 세 개 아이콘 */}
          <MoreHorizontal size={16} aria-hidden />
        </button>
      </div>

      {isMenuOpen && (
        <div className={styles["profile-menu"]} role="menu" aria-label="프로필 메뉴">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsMenuOpen(false);
              setIsSettingsOpen(true);
            }}
          >
            설정
          </button>
          <button type="button" role="menuitem" onClick={() => void signOut({ callLogout: true })}>
            로그아웃
          </button>
        </div>
      )}

      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </footer>
  );
}
