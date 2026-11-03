/**
 * Markdown과 그 그림을 함께 올리는 묶음(여러 파일 선택·드롭, Notion이 아닌 zip)을 계획한다.
 * 본문의 상대 그림 주소(`![](fig1.png)`, `<img src="images/a.png">`)를 함께 받은 파일과 맞추고,
 * 저장할 때 첨부 주소로 바꾼다. 경로 비교는 URL 디코딩·NFC·대소문자 무시다.
 * 테스트가 그대로 불러 쓰도록 shared/lib/markdown-import 외에는 import하지 않는다.
 */
import { mapOutsideCode } from "@/shared/lib/markdown-import/markdownText";
import { dirname, resolveRelativeLink } from "@/shared/lib/markdown-import/relativePath";

/** 묶음 안 파일 하나. path는 zip 안 경로이거나 고른 파일의 상대 경로(없으면 이름)다. */
export type BundleFile = {
  path: string;
  size: number;
  read: () => Promise<Uint8Array>;
};

export type BundleImage = {
  /** 본문이 가리킨 경로를 .md 위치 기준으로 푼 값 */
  ref: string;
  file: BundleFile;
};

export type BundleDocument = {
  file: BundleFile;
  markdown: string;
  images: BundleImage[];
  /** 본문이 가리키지만 묶음에 없는 그림 경로 */
  missing: string[];
};

export const MARKDOWN_EXTENSIONS = [".md"];
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

const hasExtension = (path: string, extensions: readonly string[]) => extensions.some((extension) => path.toLowerCase().endsWith(extension));
export const isMarkdownPath = (path: string) => hasExtension(path, MARKDOWN_EXTENSIONS);
export const isImagePath = (path: string) => hasExtension(path, IMAGE_EXTENSIONS);

// ![alt](dest "title") — dest는 <...> 또는 괄호 한 단계까지 허용한다(Notion 가져오기와 같은 규칙).
const MARKDOWN_IMAGE = /(!\[(?:[^[\]\n]|\[[^\]\n]*\])*\]\()(<[^>\n]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)((?:\s+"[^"\n]*")?\))/g;
// <img ... src="dest" ...> 의 src 값
const HTML_IMAGE = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"'\n]*)\2/gi;

/** 비교 키: URL 디코딩·NFC는 resolveRelativeLink가 하고, 여기서는 대소문자와 구분자만 맞춘다. */
export function pathKey(path: string): string {
  return path.normalize("NFC").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * 본문의 상대 그림 주소를 바꾼다. replace가 null을 돌려주면 그대로 둔다. 코드 블록·인라인 코드 안은 건드리지 않는다.
 * replace에는 .md 위치 기준으로 푼 경로(디코딩·NFC)가 온다. 외부 주소·data:·절대 경로는 부르지 않는다.
 */
export function rewriteImageRefs(markdown: string, markdownPath: string, replace: (ref: string) => string | null): string {
  const swap = (destination: string, wrap: (value: string) => string, original: string) => {
    const ref = resolveRelativeLink(markdownPath, destination);
    if (ref === null) return original;
    const next = replace(ref);
    return next === null ? original : wrap(next);
  };
  return mapOutsideCode(markdown, (text) => text
    .replace(MARKDOWN_IMAGE, (whole, head: string, destination: string, tail: string) =>
      swap(destination, (value) => `${head}${value}${tail}`, whole))
    .replace(HTML_IMAGE, (whole, head: string, quote: string, destination: string) =>
      swap(destination, (value) => `${head}${quote}${value}${quote}`, whole)));
}

/** 본문이 가리키는 상대 그림 경로(중복 없이, 나온 순서대로) */
export function findImageRefs(markdown: string, markdownPath: string): string[] {
  const refs = new Map<string, string>();
  rewriteImageRefs(markdown, markdownPath, (ref) => {
    if (!refs.has(pathKey(ref))) refs.set(pathKey(ref), ref);
    return null;
  });
  return [...refs.values()];
}

/**
 * 그림 경로로 파일을 찾는다. 같은 경로(대소문자·NFC 무시)를 먼저 보고, 없으면 파일 이름이 하나뿐일 때 그 파일을 쓴다.
 * 여러 파일을 함께 고르면 폴더 경로가 없어 `images/a.png`를 고른 `a.png`와 이름으로만 맞출 수 있다.
 */
export function createImageResolver(images: readonly BundleFile[]): (ref: string) => BundleFile | null {
  const byPath = new Map<string, BundleFile>();
  const byName = new Map<string, BundleFile[]>();
  for (const image of images) {
    byPath.set(pathKey(image.path), image);
    const name = pathKey(basename(image.path));
    byName.set(name, [...(byName.get(name) ?? []), image]);
  }
  return (ref) => {
    const exact = byPath.get(pathKey(ref));
    if (exact) return exact;
    const sameName = byName.get(pathKey(basename(ref))) ?? [];
    return sameName.length === 1 ? sameName[0] : null;
  };
}

/** 본문이 가리키는데 함께 받지 못한 그림 수(빠른 경고용) */
export function countMissingImages(markdown: string, markdownPath: string, images: readonly BundleFile[] = []): number {
  const resolve = createImageResolver(images);
  return findImageRefs(markdown, markdownPath).filter((ref) => !resolve(ref)).length;
}

/** .md마다 본문을 읽고 가리키는 그림을 묶음 안에서 찾는다. 어느 문서도 가리키지 않는 그림은 unused다. */
export async function planMarkdownBundle(files: readonly BundleFile[]): Promise<{ documents: BundleDocument[]; unused: BundleFile[] }> {
  const images = files.filter((file) => isImagePath(file.path));
  const resolve = createImageResolver(images);
  const used = new Set<BundleFile>();
  const documents: BundleDocument[] = [];
  const decoder = new TextDecoder("utf-8");
  for (const file of files.filter((candidate) => isMarkdownPath(candidate.path))) {
    const markdown = decoder.decode(await file.read());
    const found: BundleImage[] = [];
    const missing: string[] = [];
    for (const ref of findImageRefs(markdown, file.path)) {
      const image = resolve(ref);
      if (image) {
        found.push({ ref, file: image });
        used.add(image);
      } else missing.push(ref);
    }
    documents.push({ file, markdown, images: found, missing });
  }
  return { documents, unused: images.filter((image) => !used.has(image)) };
}

// Notion은 파일·폴더 이름 끝에 " <32자리 hex id>"를 붙인다(`홈 <id>.md`, `할일 <id>.csv`).
const NOTION_ID_NAME = /\s[0-9a-f]{32}(\.(md|csv))?$/i;

/** zip 경로 목록이 Notion 내보내기 모양인지(이름 끝 Notion id, 또는 Export-…-Part-N.zip 묶음) */
export function looksLikeNotionExport(paths: readonly string[]): boolean {
  return paths.some((path) => path.split("/").some((segment) => NOTION_ID_NAME.test(segment.normalize("NFC")))
    || /(^|\/)Export-[^/]*\.zip$/i.test(path));
}

/** 고른 파일의 묶음 안 경로. 폴더째 고르면(webkitRelativePath) 그 경로, 아니면 이름이다. */
export function fileBundlePath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return (relative || file.name).normalize("NFC");
}

export { dirname };
