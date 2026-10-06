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

/** 크기 조절 핸들이 노드 attr에 저장하는 식(소수 둘째 자리 반올림)과 같게 data-height/data-origin에서 ratio를 되살린다. */
export function recoverImageBlockRatio(height: number, origin: number): number | null {
  if (!origin) return null;
  const ratio = Number.parseFloat((height / origin).toFixed(2));
  return Number.isNaN(ratio) ? null : ratio;
}

// 노드 attr은 외부 데이터라 NaN·0·음수가 오면 data-origin이 깨져 다시 계산되지 않는다. 그때는 기본값 1을 쓴다.
function validRatioOrDefault(ratio: number | undefined): number {
  return ratio !== undefined && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * root 안의 로드된 이미지 블록 높이를 현재 폭으로 다시 맞춘다. 값이 같으면 DOM을 건드리지 않는다.
 * 폭이 0일 때(숨김 상태) 로드된 이미지는 onImageLoad가 건너뛰어 data-origin이 없다. 높이는 auto라 잘리지는 않지만
 * 노드의 ratio가 무시되고 크기 조절 핸들도 ratio를 저장하지 못하므로, 이런 이미지는 readRatio(노드 attr, 없으면 1)로 처음 계산한다.
 * maxWidth/maxHeight는 넘기지 않는다. 앱 설정(NoteEditor의 CrepeFeature.ImageBlock featureConfig)이 둘 다 지정하지 않기 때문이며,
 * 설정에 추가하면 여기서도 같은 값을 넘겨야 라이브러리와 높이가 일치한다.
 */
export function refitImageBlocks(root: HTMLElement, readRatio?: (host: Element) => number | undefined) {
  root.querySelectorAll<HTMLImageElement>(".milkdown-image-block img").forEach((image) => {
    const host = image.closest(".milkdown-image-block");
    if (!host || !image.complete) return;
    const ratio = image.dataset.origin
      ? recoverImageBlockRatio(Number(image.dataset.height), Number(image.dataset.origin))
      : validRatioOrDefault(readRatio?.(host));
    if (ratio === null) return;
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
