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

/** + (Figma PlusOutline). 16px은 FILE 제목 hover 패스(Figma 1540:17020), 20px은 새 노트 추가. */
export function SidebarPlusIcon({ className, size = 16 }: IconProps & { size?: 16 | 20 }) {
  if (size === 16) {
    return (
      <svg aria-hidden className={className} width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M7.9998 3.00005V8.00005M7.9998 8.00005V13M7.9998 8.00005H12.9998M7.9998 8.00005H2.9998" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden className={className} width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path d="M10 4V10M10 10V16M10 10H16M10 10H4" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
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

/** 변환을 마친 PDF 배지 옆 작은 체크(10×10). 색은 currentColor로 CSS가 정한다. */
export function SidebarConvertedCheckIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 5.2L4.1 7.2L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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


/**
 * 트리 행의 자체 권한 표시. 보기만은 자물쇠(설정 내비 nav-security.svg 패스), 편집 가능은 연필.
 * 행 버튼의 접근 이름에 포함되도록 role="img" + aria-label을 주고, hover 안내는 <title>로 띄운다.
 */
export function SidebarPermissionIcon({ className, permission, label }: IconProps & { permission: "view" | "edit"; label: string }) {
  if (permission === "view") {
    return (
      <svg role="img" aria-label={label} className={className} width="14" height="16" viewBox="0 0 15.6 17.28" fill="none">
        <title>{label}</title>
        <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.8 10.4797V12.4797" />
          <path d="M3.8 6.47969V4.80032C3.8 3.73945 4.22143 2.72204 4.97157 1.97189C5.72172 1.22175 6.73913 0.80032 7.8 0.80032C8.86087 0.80032 9.87828 1.22143 10.6284 1.97157C11.3786 2.72172 11.8 3.73913 11.8 4.8V6.47937" />
          <rect x="0.8" y="6.47969" width="14" height="10" rx="2" />
        </g>
      </svg>
    );
  }
  return (
    <svg role="img" aria-label={label} className={className} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <title>{label}</title>
      <path d="M10.6 3.2L12.8 5.4M3 13L3.6 10.2L11.1 2.7C11.5 2.3 12.1 2.3 12.5 2.7L13.3 3.5C13.7 3.9 13.7 4.5 13.3 4.9L5.8 12.4L3 13Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
