/**
 * 문서 하나의 이미지를 본문 저장 요청 여러 번으로 나눈다.
 * 서버 계약: 저장 한 번에 새 첨부 20개까지, 첨부 하나 10MB, 요청 하나 100MB.
 * 테스트가 그대로 불러 쓰도록 다른 모듈을 import하지 않는다.
 */

const MIB = 1024 * 1024;

export const ATTACHMENTS_PER_SAVE = 20;
export const ATTACHMENT_MAX_BYTES = 10 * MIB;
export const SAVE_REQUEST_MAX_BYTES = 100 * MIB;

/**
 * 이미지 순서를 지키며 묶는다. 각 묶음은 개수·바이트 상한을 넘지 않는다.
 * 본문 자체 크기(markdownBytes)도 요청 크기에 넣는다. 이미지가 없으면 빈 배열이다.
 */
export function planAttachmentBatches(
  sizes: readonly number[],
  { markdownBytes = 0, maxCount = ATTACHMENTS_PER_SAVE, maxRequestBytes = SAVE_REQUEST_MAX_BYTES } = {}
): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let bytes = markdownBytes;
  sizes.forEach((size, index) => {
    if (current.length > 0 && (current.length >= maxCount || bytes + size > maxRequestBytes)) {
      batches.push(current);
      current = [];
      bytes = markdownBytes;
    }
    current.push(index);
    bytes += size;
  });
  if (current.length > 0) batches.push(current);
  return batches;
}
