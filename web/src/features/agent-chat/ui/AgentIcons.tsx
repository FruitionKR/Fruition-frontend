import { cx } from "@/shared/lib/classNames";
import styles from "./AgentChat.module.css";

// 채팅 패널 전용 아이콘. Figma(1436:17258) 원본 패스를 그대로 쓰되, 라이트/다크 테마에서 색이 바뀌도록 currentColor로 그린다.

/**
 * 펼침 셰브론 (Figma arrow, 16px). 시안(1540:19459)에서 쓰는 곳마다 모양·굵기가 달라 맞춰 고른다.
 * 기본: 진행 단계 제목(M4 6 L8 10 L12 6, 1.4) / wide: 발견 사항·모델 선택(M4 6 L8.3 10.3 L12.6 6, 1.4) / 헤더 탭은 wide + 1.6.
 */
export function AgentChevronIcon({ className, isWide = false, strokeWidth = 1.4 }: { className?: string; isWide?: boolean; strokeWidth?: number }) {
  return (
    <svg aria-hidden className={className} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d={isWide ? "M4 6L8.3 10.3L12.6 6" : "M4 6L8 10L12 6"} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 옵션 ⋯ (Figma 1540:19125: 지름 1.6 점 + 선 1.4 = 지름 3 점 3개, 폭 14.2) */
export function AgentMoreIcon() {
  return (
    <svg aria-hidden width="14.2" height="3" viewBox="0 0 14.2 3" fill="currentColor">
      <circle cx="1.5" cy="1.5" r="1.5" />
      <circle cx="7.1" cy="1.5" r="1.5" />
      <circle cx="12.7" cy="1.5" r="1.5" />
    </svg>
  );
}

/** 전송 화살표 (Figma send 내부 패스, 28px 원 기준) */
export function AgentSendIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path d="M14 18V10M17.2 13.0185L14 10L10.8 13.0185" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 진행 단계 완료 체크 (Figma 10px 원 안의 체크) */
export function AgentStepCheckIcon() {
  return (
    <svg aria-hidden width="10" height="10" viewBox="0.5 0.5 10 10" fill="none">
      <path d="M3.5 5.2911L4.81643 6.67902C4.89035 6.75696 5.01263 6.76258 5.0934 6.69176L7.5 4.58143" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

/** Fruition AI 파형 마크(막대 4개). 입력창 우하단 음성 버튼(28px)에서 쓴다. */
export function AgentWaveMark({ size }: { size: "small" }) {
  return (
    <span aria-hidden className={cx(styles["wave-mark"], styles[`is-${size}`])}>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * Figma에서 내려받은 단색 SVG 에셋을 모양(mask)으로만 쓰고 색은 currentColor로 칠한다.
 * 에셋 색(라이트 테마 파랑)이 다크 테마 주 색(노랑)과 다르므로 테마 색을 따르게 한다.
 */
export function AgentAssetIcon({ src, size, className }: { src: { src: string }; size: number; className?: string }) {
  const mask = `url(${src.src})`;
  return (
    <span
      aria-hidden
      className={cx(styles["asset-icon"], className)}
      style={{ width: size, height: size, maskImage: mask, WebkitMaskImage: mask }}
    />
  );
}
