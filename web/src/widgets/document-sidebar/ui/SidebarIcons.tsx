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

/** 원본 PDF와 변환된 노트 사이의 이동을 나타내는 작은 연결 아이콘. */
export function SidebarConversionLinkIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="m10 13 4-4M8 15l-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m2 2 1-1a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
 * 보기 전용 권한만 눈 아이콘으로 표시한다. 편집 가능은 기본 상태로 아이콘을 생략한다.
 * 행 버튼의 접근 이름에 포함되도록 role="img" + aria-label을 준다. hover 안내는 호출부의 Tooltip으로 표시한다.
 */
export function SidebarPermissionIcon({ className, permission, label }: IconProps & { permission: "view" | "edit"; label: string }) {
  if (permission !== "view") return null;
  return (
    <svg role="img" aria-label={label} className={className} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1 8S3.5 3.5 8 3.5 15 8 15 8 12.5 12.5 8 12.5 1 8 1 8Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** 트리 행 hover 버튼: 이름 변경 연필 (16×16) */
export function SidebarRenameIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M9.5 3.5L12.5 6.5M2.5 13.5L3 10.5L10.6 2.9C11.2 2.3 12.1 2.3 12.7 2.9L13.1 3.3C13.7 3.9 13.7 4.8 13.1 5.4L5.5 13L2.5 13.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 트리 행 hover 버튼: 권한 설정 자물쇠 (16×16) */
export function SidebarLockIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 7V5C5.5 3.6 6.6 2.5 8 2.5C9.4 2.5 10.5 3.6 10.5 5V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** 트리 행 hover 버튼: 삭제 휴지통 (16×16) */
export function SidebarTrashIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 4.5H13.5M6.5 4.5V3C6.5 2.7 6.7 2.5 7 2.5H9C9.3 2.5 9.5 2.7 9.5 3V4.5M4 4.5L4.6 12.6C4.7 13.1 5.1 13.5 5.6 13.5H10.4C10.9 13.5 11.3 13.1 11.4 12.6L12 4.5M6.8 7V11M9.2 7V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 트리 행 hover 버튼: 우클릭 메뉴를 여는 ⋯ (16×16) */
export function SidebarMoreIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="3.5" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12.5" cy="8" r="1.25" />
    </svg>
  );
}
