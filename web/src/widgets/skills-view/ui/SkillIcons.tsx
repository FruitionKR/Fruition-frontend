// 스킬 화면 아이콘 (Figma 1482:9848). <img>는 currentColor를 못 받아 라이트/다크 색이 바뀌지 않으므로
// Figma 에셋 패스를 그대로 옮기고 하드코딩된 #8B95A1만 currentColor로 바꾼다. 크기는 에셋 루트 width/height를 따른다.

type IconProps = { className?: string };

/** 검색 (Figma Group 1437256821, 15.17×15.6) */
export function SkillSearchIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="15.1672" height="15.5998" viewBox="0 0 15.1672 15.5998" fill="none">
      <path d="M14.3672 14.7998L10.6021 11.0347" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.4849 6.64245C12.4849 9.86915 9.86915 12.4849 6.64245 12.4849C3.41575 12.4849 0.8 9.86915 0.8 6.64245C0.8 3.41575 3.41575 0.8 6.64245 0.8C9.86915 0.8 12.4849 3.41575 12.4849 6.64245Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 열 정렬 화살표 (Figma Vector 1482:10992, 12.45×11.2) */
export function SkillSortIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="12.45" height="11.2" viewBox="0 0 12.45 11.2" fill="none">
      <path d="M3.1 8.1V0.6M5.6 3.1L3.1 0.6L0.6 3.1M9.35 3.1V10.6M6.85 8.1L9.35 10.6L11.85 8.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 행 더보기 (Figma folder 1482:10956, 28×28) */
export function SkillMoreIcon({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="28" height="28" viewBox="0 0 28 28" fill="none">
      <circle cx="8.16683" cy="14.0001" r="0.833333" fill="currentColor" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="14.0002" cy="14.0001" r="0.833333" fill="currentColor" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="19.8335" cy="14.0001" r="0.833333" fill="currentColor" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/**
 * 실행 안내 말풍선 꼬리 (Figma 1567:25799: Polygon 2 채움 + Polygon 1 테두리, 왼쪽을 가리키도록 -90° 회전).
 * 다크 모드에서도 말풍선과 같은 색이 되도록 Figma 경로를 토큰 색으로 그린다.
 * 오른쪽 끝 채움 띠가 말풍선 테두리를 덮어 꼬리와 본문이 이어져 보이게 한다(Figma도 채움이 테두리 위로 겹친다).
 */
export function SkillCoachArrow({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="20" height="23.6204" viewBox="0 0 20 23.6204" fill="none">
      <g transform="translate(0 23.6204) rotate(-90)">
        <path d="M22.8703 15.9066L15.2743 2.75C13.7347 0.0833333 9.88571 0.0833337 8.34611 2.75L0.750125 15.9066" fill="var(--color-canvas)" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round" />
      </g>
      <rect x="15.2" y="1.5" width="4.8" height="20.6" fill="var(--color-canvas)" />
    </svg>
  );
}
