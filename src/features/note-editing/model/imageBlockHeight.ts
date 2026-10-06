// Crepe 이미지 블록은 이미지가 로드될 때의 본문 폭으로 높이를 정해 style.height에 고정한다
// (@milkdown/components 7.22.1 image-block/view/components/image-viewer.tsx의 onImageLoad).
// 채팅창을 열어 폭이 줄면 높이는 그대로라 object-fit: cover로 좌우가 잘린다(이슈 #63).
// 폭이 바뀔 때 같은 공식으로 다시 계산한다. 라이브러리를 올리면 onImageLoad와 공식·dataset 이름을 다시 맞춰 본다.
// (Milkdown을 import하지 않는 순수 모듈. 테스트에서 바로 불러 쓴다.)

/** onImageLoad와 같은 공식으로 기본 높이(origin)와 ratio를 곱한 높이를 소수 둘째 자리 문자열로 돌려준다. */
export function computeImageBlockHeight({
  naturalWidth,
  naturalHeight,
  hostWidth,
  ratio,
  maxWidth,
  maxHeight
}: {
  naturalWidth: number;
  naturalHeight: number;
  hostWidth: number;
  ratio: number;
  maxWidth?: number;
  maxHeight?: number;
}): { origin: string; height: string } | null {
  if (!naturalWidth || !hostWidth) return null;
  const width = maxWidth && maxWidth < hostWidth ? maxWidth : hostWidth;
  let origin = naturalWidth < width ? naturalHeight : width * (naturalHeight / naturalWidth);
  if (maxHeight && origin > maxHeight) origin = maxHeight;
  return { origin: origin.toFixed(2), height: (origin * ratio).toFixed(2) };
}

/** root 안의 로드된 이미지 블록 높이를 현재 폭으로 다시 맞춘다. 값이 같으면 DOM을 건드리지 않는다. */
export function refitImageBlocks(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>(".milkdown-image-block img[data-origin]").forEach((image) => {
    const host = image.closest(".milkdown-image-block");
    const previousOrigin = Number(image.dataset.origin);
    if (!host || !previousOrigin) return;
    // 크기 조절 핸들이 노드 attr에 저장하는 식(소수 둘째 자리 반올림)과 같게 ratio를 되살린다.
    const ratio = Number.parseFloat((Number(image.dataset.height) / previousOrigin).toFixed(2));
    if (Number.isNaN(ratio)) return;
    const next = computeImageBlockHeight({
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      hostWidth: host.getBoundingClientRect().width,
      ratio
    });
    if (!next || (next.origin === image.dataset.origin && next.height === image.dataset.height)) return;
    image.dataset.origin = next.origin;
    image.dataset.height = next.height;
    image.style.height = `${next.height}px`;
  });
}
