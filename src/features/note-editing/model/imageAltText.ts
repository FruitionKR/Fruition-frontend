// Crepe image-block은 Markdown alt 칸에 크기 비율을 항상 소수점 둘째 자리("1.00")로 쓰고 읽는다.
// 비율 판정은 Crepe가 쓰는 형식과 정확히 같을 때만 한다. "2024" 같은 정수 alt는 사람이 쓴 텍스트로 본다.
// (Milkdown을 import하지 않는 순수 모듈. 테스트에서 바로 불러 쓴다.)
const CREPE_RATIO_ALT = /^\d+\.\d{2}$/;

/** Markdown alt 값을 (표시할 alt, 크기 비율)로 나눈다. */
export function splitImageAlt(alt: string | null | undefined): { alt: string; ratio: number } {
  const text = typeof alt === "string" ? alt : "";
  const isRatio = CREPE_RATIO_ALT.test(text) && Number(text) !== 0;
  return isRatio ? { alt: "", ratio: Number(text) } : { alt: text, ratio: 1 };
}

/** 저장 시 alt 칸에 쓸 값. 실제 alt가 있으면 그것, 없으면 Crepe 형식의 비율. */
export function formatImageAlt(alt: string, ratio: number): string {
  return alt || `${Number.parseFloat(String(ratio)).toFixed(2)}`;
}
