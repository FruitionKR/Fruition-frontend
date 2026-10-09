// 문서 사이드바 아이콘 (Figma 1486:4396). Figma 에셋 패스를 옮기고 색만 currentColor로 바꿔 테마를 따른다.

type IconProps = { className?: string };

/** 통합 검색 돋보기 (Figma 1486:4399 16×16) */
export function SidebarSearchIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M13.2918 14.1222L10.1984 11.0289" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.7453 7.42031C11.7453 10.0713 9.59628 12.2203 6.94531 12.2203C4.29435 12.2203 2.14531 10.0713 2.14531 7.42031C2.14531 4.76935 4.29435 2.62031 6.94531 2.62031C9.59628 2.62031 11.7453 4.76935 11.7453 7.42031Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 폴더 펼침 셰브론 (Figma arrow 16×16, 아래 방향). 접힌 상태는 CSS에서 -90도 돌린다. */
export function SidebarChevronIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 6L8.3 10.3L12.6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** + (Figma PlusOutline). FILE 제목 16px, 새 페이지 추가 20px 두 크기가 같은 비율이라 size로 맞춘다. */
export function SidebarPlusIcon({ className, size = 16 }: IconProps & { size?: 16 | 20 }) {
  return (
    <svg aria-hidden className={className} width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path d="M10 4V10M10 10V16M10 10H16M10 10H4" stroke="currentColor" strokeWidth={size === 16 ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 위키 편입 체크박스 선택 상태 (기존 wiki/check_on.svg 패스). 바탕은 primary, 체크는 on-primary로 테마를 따른다. */
export function SidebarCheckOnIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M0 4C0 1.79086 1.79086 0 4 0H16C18.2091 0 20 1.79086 20 4V16C20 18.2091 18.2091 20 16 20H4C1.79086 20 0 18.2091 0 16V4Z" fill="var(--color-primary)" />
      <path d="M5 9.17051L8.92157 12.8571L15 7.14286" stroke="var(--color-on-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 워크스페이스 이름 옆 펼침 셰브론 (Figma 1527:16282 arrow 16×16) */
export function SidebarWorkspaceChevronIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M5 6.5L8 9.5L11 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 사이드바 접기 (Figma 1527:16285 icon). Figma 에셋의 바깥 stroke 여백까지 포함한 크기다. */
export function SidebarCollapseIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="14.4909" height="13.4" viewBox="0 0 14.4909 13.4" fill="none">
      <rect x="0.7" y="0.7" width="13.0909" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8.28827 0.700548L8.28827 3.15577C8.28831 3.32936 8.3573 3.49581 8.48005 3.61854L10.0601 5.19861C10.1829 5.32133 10.2519 5.48779 10.2519 5.66137L10.2519 7.73759C10.2519 7.91117 10.1829 8.07763 10.0601 8.20036L8.48005 9.78043C8.3573 9.90315 8.28831 10.0696 8.28827 10.2432L8.28827 12.6997" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
