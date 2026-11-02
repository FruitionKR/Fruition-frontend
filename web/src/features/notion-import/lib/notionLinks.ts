/**
 * Notion Markdown의 상대 링크·이미지를 가져오기 대상에 맞게 바꾼다.
 * 링크 대상은 URL 인코딩된 상대 경로(`Sub%20Page%20<id>.md`)이며, 그 Markdown 파일 위치 기준으로 푼다.
 * 이 단계에서는 문서 ID를 모르므로 자리표시 토큰을 남기고, 실제 주소는 renderLinks/renderImages가 채운다.
 */
import { mapOutsideCode } from "./markdownText";

// [text](dest "title") / ![alt](dest). dest는 <...> 또는 괄호 한 단계까지 허용한다.
const LINK = /(!?)\[((?:[^[\]\n]|\[[^\]\n]*\])*)\]\((<[^>\n]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+"[^"\n]*")?\)/g;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export const LINK_TOKEN = /\u0000L(\d+)\u0000/g;
export const IMAGE_TOKEN = /\u0000I(\d+)\u0000/g;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 파일 경로의 폴더 부분("a/b/c.md" → "a/b") */
export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/**
 * 문서 안 링크를 zip 안 경로로 푼다. 외부 주소·같은 문서 앵커·zip 밖으로 나가는 경로는 null.
 * `#앵커`와 `?query`는 버린다(앱은 문서 안 블록 위치로 이동하지 않는다).
 */
export function resolveRelativeLink(fromPath: string, href: string): string | null {
  const raw = href.trim().replace(/^<|>$/g, "");
  if (!raw || raw.startsWith("#") || raw.startsWith("/") || raw.startsWith("\\") || SCHEME.test(raw)) return null;
  const withoutFragment = raw.replace(/[#?].*$/, "");
  if (!withoutFragment) return null;
  const segments = dirname(fromPath).split("/").filter(Boolean);
  for (const segment of safeDecode(withoutFragment).normalize("NFC").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
}

const NOTION_HOST = /(^|\.)(notion\.so|notion\.site|notion\.com)$/i;
const DASHED_ID = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;
const PLAIN_ID = /(?:^|-)([0-9a-f]{32})$/i;

/**
 * Notion 절대 링크(`https://app.notion.com/p/<slug>-<id>`, `https://www.notion.so/<워크스페이스>/<slug>-<id>?pvs=4` 등)의
 * 페이지 id(소문자 32자리 hex). Notion 링크가 아니거나 id가 없으면 null.
 */
export function notionPageIdFromUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href.trim().replace(/^<|>$/g, ""));
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !NOTION_HOST.test(url.hostname)) return null;
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const dashed = DASHED_ID.exec(last);
  if (dashed) return dashed.slice(1).join("").toLowerCase();
  return PLAIN_ID.exec(last)?.[1].toLowerCase() ?? null;
}

/**
 * Notion 데이터베이스 값(CSV 칸·행 페이지 속성)은 관계·링크를 `이름 (주소)`로 적는다(여러 개면 `, `로 잇는다).
 * 주소가 Notion 절대 링크이거나 zip 안 상대 경로(.md·.csv·.pdf)이면 Markdown 링크 `[이름](주소)`로 바꿔 tokenizeLinks가
 * 앱 문서 링크로 잇게 한다. 이름에 `[`·`]`·`|`·`\`가 있으면 표·링크 문법을 깨므로 그대로 둔다.
 */
export function linkifyNotionReferences(text: string): string {
  return text.replace(
    /(^|, )([^,()[\]|\\]+?) \(((?:https?:\/\/[^\s()]+)|(?:[^\s()]+\.(?:md|csv|pdf)))\)(?=$|, )/gi,
    (whole, lead: string, label: string, href: string) => (/^https?:/i.test(href) && !notionPageIdFromUrl(href) ? whole : `${lead}[${label}](${href})`)
  );
}

export type LinkTarget =
  /** 가져오는 문서. key는 그 문서의 zip 경로 */
  | { kind: "document"; key: string }
  /** 이 문서에 첨부할 이미지 */
  | { kind: "image"; path: string }
  /** zip 안을 가리키지만 가져오지 않는 대상(건너뛴 행 페이지·없는 파일 등) */
  | { kind: "broken" };

export type RewrittenLinks = {
  /** 링크·이미지를 토큰으로 바꾼 본문 */
  markdown: string;
  /** 토큰 L<n>의 원래 글자와 대상 문서 key */
  links: { text: string; key: string }[];
  /** 토큰 I<n>의 이미지 zip 경로와 대체 글자(같은 이미지는 한 번만) */
  images: { path: string; alt: string }[];
  /** 대상을 찾지 못해 글자만 남긴 링크·이미지의 원래 주소 */
  broken: string[];
  /** 앱 문서 링크로 바꾼 Notion 절대 링크 수 */
  notionLinks: number;
};

/**
 * 본문의 상대 링크·이미지를 토큰으로 바꾼다. Notion 절대 링크는 resolveNotionId가 zip 안 페이지를 찾을 때만 바꾸고,
 * 나머지 외부 링크와 코드 안은 그대로 둔다.
 */
export function tokenizeLinks(
  markdown: string,
  fromPath: string,
  resolve: (path: string, isImage: boolean) => LinkTarget,
  resolveNotionId: (id: string) => string | undefined = () => undefined
): RewrittenLinks {
  const links: RewrittenLinks["links"] = [];
  const images: RewrittenLinks["images"] = [];
  const broken: string[] = [];
  const imageIndex = new Map<string, number>();
  let notionLinks = 0;
  const result = mapOutsideCode(markdown, (text) => text.replace(LINK, (whole, bang: string, label: string, href: string) => {
    if (bang !== "!") {
      const notionId = notionPageIdFromUrl(href);
      const key = notionId ? resolveNotionId(notionId) : undefined;
      if (key) {
        notionLinks += 1;
        return `\u0000L${links.push({ text: label, key }) - 1}\u0000`;
      }
    }
    const path = resolveRelativeLink(fromPath, href);
    if (path === null) return whole;
    const target = resolve(path, bang === "!");
    if (target.kind === "image" && bang === "!") {
      let index = imageIndex.get(target.path);
      if (index === undefined) {
        index = images.push({ path: target.path, alt: label }) - 1;
        imageIndex.set(target.path, index);
      }
      return `\u0000I${index}\u0000`;
    }
    if (target.kind === "document" && bang !== "!") {
      return `\u0000L${links.push({ text: label, key: target.key }) - 1}\u0000`;
    }
    broken.push(href);
    // 이미지는 대체 글자만, 링크는 글자만 남긴다.
    return label;
  }));
  return { markdown: result, links, images, broken, notionLinks };
}

/** Markdown 링크 글자·주소 안에서 문법을 깨는 문자를 이스케이프한다. */
function escapeLinkText(text: string): string {
  return text.replace(/([[\]\\])/g, "\\$1");
}

/** 앱 안 문서 주소. 홈 화면이 ?doc=<id>로 문서를 연다. */
export function documentHref(documentId: string): string {
  return `/home?doc=${encodeURIComponent(documentId)}`;
}

/** 링크 토큰을 문서 주소로 채운다. 아직 ID가 없는 대상은 글자만 남긴다. */
export function renderLinks(markdown: string, links: RewrittenLinks["links"], documentIdOf: (key: string) => string | undefined): string {
  return markdown.replace(LINK_TOKEN, (_whole, index: string) => {
    const link = links[Number(index)];
    if (!link) return "";
    const id = documentIdOf(link.key);
    return id ? `[${escapeLinkText(link.text)}](${documentHref(id)})` : link.text;
  });
}

/**
 * 이미지 토큰을 채운다. 이미 저장된 이미지는 서버 경로, 이번 저장에 보낼 이미지는 attachment://<uuid>,
 * 나중 저장으로 미룬 이미지는 아직 넣지 않는다(placeholder와 file part 수가 같아야 한다).
 */
export function renderImages(
  markdown: string,
  images: RewrittenLinks["images"],
  source: (index: number) => string | null
): string {
  return markdown.replace(IMAGE_TOKEN, (_whole, index: string) => {
    const image = images[Number(index)];
    const src = image ? source(Number(index)) : null;
    return image && src ? `![${escapeLinkText(image.alt)}](${src})` : "";
  });
}
