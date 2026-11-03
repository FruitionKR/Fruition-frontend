/**
 * Notion "Markdown & CSV" 내보내기 파일 목록을 Fruition 폴더·문서 계획으로 바꾼다(서버에 쓰기 전 미리보기 겸 실행 계획).
 *
 * 매핑 규칙
 * - `페이지 <id>.md` → 문서 "페이지". 같은 이름의 폴더(`페이지 <id>/` 또는 id 없는 `페이지/`)에 하위 페이지가 있으면
 *   Obsidian처럼 문서 "페이지" 옆(같은 부모)에 폴더 "페이지"를 만들고 하위 페이지는 그 폴더에 둔다.
 *   부모 본문이 링크하지 않은 하위 페이지는 본문 끝 "하위 페이지" 목록에 링크로 붙인다.
 * - `DB <id>.csv`(`_all.csv`가 있으면 그쪽) → GFM 표 문서 하나. 행 폴더(`DB <id>/` 또는 `DB/`)가 있으면 하위 페이지가 있는
 *   페이지와 같은 규칙으로 표 문서 옆에 같은 이름 폴더를 만들고, 행 페이지는 그 폴더의 문서가 된다. 표의 제목 칸(첫 열)은 그 행
 *   문서로 링크하고, 칸 안의 관계·Notion 링크도 앱 문서로 잇는다. 행 폴더 안 페이지 중 CSV 행과 제목이 맞지 않는 것은 일반
 *   하위 페이지로 가져온다(행으로 세지 않는다). 행 페이지 안의 데이터베이스도 같은 규칙을 따른다(재귀).
 * - 행 페이지 본문 맨 앞의 Notion 속성 줄(`이름: 값`)은 작은 "속성 | 값" 표로 바꾼다.
 * - PDF(`%PDF-`로 시작, 100MB 이하)는 PDF 문서로 올린다. 자리는 zip 안 위치 그대로라, 페이지의 첨부 폴더(`페이지/`)에 든
 *   PDF는 그 페이지 옆 같은 이름 폴더에 들어간다(하위 페이지와 같은 규칙). 본문의 PDF 링크는 그 PDF 문서로 잇는다.
 * - 이름 끝 ` <32 hex>`를 떼고 NFC로 맞춘 뒤, 같은 폴더 안 중복은 ` (2)`로 피한다.
 * - 이미지는 본문에서 참조할 때만 그 문서의 첨부로 올린다(PNG·JPEG·GIF·WebP, 매직 바이트로 확인).
 * - PPTX 등 그 밖의 첨부는 가져오지 않는다(본문의 링크 글자는 남긴다).
 */
import { csvToMarkdownTable, parseCsv } from "./csvTable";
import { sniffImageMime, type ImageMime } from "./imageSniff";
import { sanitizeNotionMarkdown } from "./notionHtml";
import { dirname, linkifyNotionReferences, tokenizeLinks, type LinkTarget, type RewrittenLinks } from "./notionLinks";
import { cleanNotionName, nameKey, splitExtension, uniqueName } from "./notionNames";
import { ATTACHMENT_MAX_BYTES } from "./attachmentBatches";

const MIB = 1024 * 1024;
/** 서버 Markdown 본문 상한(UTF-8) */
export const MARKDOWN_MAX_BYTES = 5 * MIB;
/** 서버 PDF 직접 업로드 상한 */
export const PDF_MAX_BYTES = 100 * MIB;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const utf8Decoder = new TextDecoder("utf-8");
const utf8Encoder = new TextEncoder();

/** readHead가 없으면 read()로 전부 푼 뒤 앞부분만 본다. */
export type SourceFile = { path: string; size: number; read: () => Uint8Array; readHead?: (length: number) => Uint8Array };

export type PlanFolder = {
  key: string;
  name: string;
  parentKey: string | null;
  /** 이 폴더와 같은 이름으로 폴더 옆(같은 부모)에 두는 페이지 문서(zip 경로). 없으면 생략 */
  pageDocumentKey?: string;
};

export type PlanImage = { path: string; alt: string; size: number; mime: ImageMime; fileName: string; read: () => Uint8Array };

export type PlanDocument = {
  key: string;
  name: string;
  folderKey: string | null;
  /** row: CSV 행과 맞는 데이터베이스 행 페이지 */
  kind: "page" | "table" | "row";
  /** 링크·이미지가 토큰으로 남은 본문 */
  markdown: string;
  links: RewrittenLinks["links"];
  images: PlanImage[];
  /** 토큰을 채우기 전 본문 바이트(UTF-8) */
  bytes: number;
};

/** PDF 문서로 올릴 파일. 본문은 올릴 때 read()로 그때 푼다(미리 메모리에 들고 있지 않는다). */
export type PlanPdf = { key: string; name: string; folderKey: string | null; size: number; read: () => Uint8Array };

export type SkippedItem = { path: string; reason: string };

export type ImportPlan = {
  /** 상위 폴더가 먼저 오는 순서 */
  folders: PlanFolder[];
  documents: PlanDocument[];
  /** PDF 문서. Markdown 문서와 따로 직접 업로드한다. */
  pdfs: PlanPdf[];
  skipped: SkippedItem[];
  /** zip 안에 없는 대상을 가리켜 글자만 남긴 링크 */
  brokenLinks: { documentKey: string; href: string }[];
  /** 앱 문서 링크로 바꾼 Notion 절대 링크 수 */
  notionLinkCount: number;
  /** 문서로 가져오는 데이터베이스 행 페이지 수 */
  rowPageCount: number;
  tableCount: number;
  imageCount: number;
  /** 문서 본문 + 이미지 + PDF 바이트 */
  totalBytes: number;
  /** 문서 + 이미지 + PDF 수(서버 item_count) */
  itemCount: number;
};

export type ExistingNames = { folders: Iterable<string>; documents: Iterable<string> };

function decodeText(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

function byteLength(text: string): number {
  return utf8Encoder.encode(text).length;
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Notion 일부 내보내기는 모든 파일을 `Export-<id>/` 아래에 둔다. 그 껍데기 폴더는 벗긴다. */
export function stripExportRoot(files: SourceFile[]): SourceFile[] {
  const first = files[0]?.path.split("/")[0];
  if (!first || !/^Export-/i.test(first)) return files;
  if (!files.every((file) => file.path.startsWith(`${first}/`))) return files;
  return files.map((file) => ({ ...file, path: file.path.slice(first.length + 1) }));
}

/** csv 경로에서 `_all` 꼬리를 뗀 데이터베이스 기준 경로(확장자 없음) */
function databaseBase(path: string): string {
  return path.replace(/\.csv$/i, "").replace(/_all$/i, "");
}

/**
 * Notion 페이지는 본문 첫 줄에 `# 제목`을 둔다. 앱은 문서 이름을 편집기 위에 따로 보여 주므로,
 * 첫 줄 H1이 문서 이름(또는 중복을 피하기 전 이름)과 같으면 그 줄과 뒤 빈 줄을 지운다.
 */
export function stripLeadingTitle(markdown: string, titles: readonly string[]): string {
  const match = /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!match) return markdown;
  const heading = nameKey(match[1].trim());
  if (!titles.some((title) => nameKey(title) === heading)) return markdown;
  return markdown.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, "");
}

/** 모든 집합에서 비어 있는 이름을 고르고 각 집합에 넣는다. */
function uniqueNameAcross(name: string, takenSets: Set<string>[]): string {
  let candidate = name;
  for (let number = 2; takenSets.some((taken) => taken.has(nameKey(candidate))); number += 1) candidate = `${name} (${number})`;
  takenSets.forEach((taken) => taken.add(nameKey(candidate)));
  return candidate;
}

/**
 * 부모 페이지 본문이 링크하지 않은 하위 문서를 본문 끝 "하위 페이지" 목록에 링크 토큰으로 붙인다.
 * 하위 페이지가 폴더 안으로 옮겨져도 부모 문서에서 모두 찾아갈 수 있게 한다.
 */
export function appendChildLinks(tokenized: RewrittenLinks, children: readonly { key: string; name: string }[]): RewrittenLinks {
  const linked = new Set(tokenized.links.map((link) => link.key));
  const missing = children.filter((child) => !linked.has(child.key));
  if (missing.length === 0) return tokenized;
  const links = [...tokenized.links];
  const items = missing.map((child) => `- \u0000L${links.push({ text: child.name, key: child.key }) - 1}\u0000`);
  const body = tokenized.markdown.replace(/\s+$/, "");
  return { ...tokenized, links, markdown: `${body}${body ? "\n\n" : ""}## 하위 페이지\n\n${items.join("\n")}\n` };
}

/** 파일 경로들의 모든 상위 폴더 경로 */
function directoriesOf(paths: Iterable<string>): Set<string> {
  const directories = new Set<string>();
  for (const path of paths) {
    for (let directory = dirname(path); directory; directory = dirname(directory)) directories.add(directory);
  }
  return directories;
}

/**
 * 페이지·데이터베이스(확장자를 뗀 경로)에 딸린 폴더. Notion은 `이름 <id>/`로도, id 없이 `이름/`으로도 내보낸다.
 * 둘 다 없으면 null.
 */
export function childDirectoryOf(basePath: string, directories: ReadonlySet<string>): string | null {
  if (directories.has(basePath)) return basePath;
  const parent = dirname(basePath);
  const cleaned = cleanNotionName(lastSegment(basePath));
  const withoutId = parent ? `${parent}/${cleaned}` : cleaned;
  return withoutId !== basePath && directories.has(withoutId) ? withoutId : null;
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 행 페이지와 CSV 제목을 맞출 때 쓰는 키. Notion은 파일 이름에서 `:` `/` 등을 공백으로 바꾸므로 그 차이를 무시한다. */
export function rowTitleKey(title: string): string {
  return nameKey(title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim());
}

/** 본문 첫 줄 `# 제목`의 제목. 없으면 null */
function leadingTitle(markdown: string): string | null {
  return /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/.exec(markdown)?.[1].trim() ?? null;
}

const PROPERTY_LINE = /^([^\s#>|`*\-:][^:\n]{0,99}):(?: (.*))?$/;

/**
 * 행 페이지 본문 맨 앞의 Notion 속성 줄(`이름: 값`, 빈 줄 전까지)을 "속성 | 값" 표로 바꾼다. 여러 줄 값(속성 줄이 아닌
 * 다음 줄)은 앞 값에 공백으로 잇는다. 값의 관계·Notion 링크는 Markdown 링크로 바꿔 둔다(tokenizeLinks가 앱 문서로 잇는다).
 * 첫 줄이 속성 줄이 아니면 그대로 둔다.
 */
export function propertiesToTable(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  if (!PROPERTY_LINE.test(lines[0] ?? "")) return markdown;
  const properties: { name: string; value: string }[] = [];
  let count = 0;
  for (; count < lines.length && lines[count].trim() !== ""; count += 1) {
    const match = PROPERTY_LINE.exec(lines[count]);
    if (match) properties.push({ name: match[1], value: match[2] ?? "" });
    else properties[properties.length - 1].value += ` ${lines[count].trim()}`;
  }
  const cell = (value: string) => value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").trim() || " ";
  const rows = properties.map(({ name, value }) => `| ${cell(name)} | ${linkifyNotionReferences(cell(value))} |`);
  const rest = lines.slice(count).join("\n").replace(/^(?:[ \t]*\n)+/, "");
  return `| 속성 | 값 |\n| --- | --- |\n${rows.join("\n")}\n${rest ? `\n${rest}` : ""}`;
}

/** zip 안 경로를 from 문서 기준 상대 링크 주소(세그먼트별 URL 인코딩)로 만든다. 같은 폴더 아래만 쓴다. */
function relativeHref(fromPath: string, target: string): string {
  const base = dirname(fromPath);
  const relative = base ? target.slice(base.length + 1) : target;
  return relative.split("/").map(encodeURIComponent).join("/");
}

function hasPdfMagic(head: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => head[index] === byte);
}

type ImageInfo = { size: number; mime: ImageMime | null; read: () => Uint8Array };

/** 파일 목록으로 가져오기 계획을 만든다. 서버에는 아무것도 보내지 않는다. */
export async function buildImportPlan(input: SourceFile[], existing: ExistingNames = { folders: [], documents: [] }): Promise<ImportPlan> {
  const files = stripExportRoot(input);
  const skipped: SkippedItem[] = [];
  const pages = new Map<string, SourceFile>();
  const images = new Map<string, SourceFile>();
  const databases = new Map<string, SourceFile>();

  // 데이터베이스: 기준 경로마다 _all.csv를 우선한다.
  for (const file of files) {
    if (splitExtension(lastSegment(file.path)).extension !== ".csv") continue;
    const base = databaseBase(file.path);
    const current = databases.get(base);
    if (!current || /_all\.csv$/i.test(file.path)) databases.set(base, file);
  }
  const allDirectories = directoriesOf(files.map((file) => file.path));
  // 데이터베이스 기준 경로 → 행 폴더
  const rowDirectoryOf = new Map<string, string>();
  for (const base of databases.keys()) {
    const directory = childDirectoryOf(base, allDirectories);
    if (directory) rowDirectoryOf.set(base, directory);
  }
  const csvToDatabase = new Map<string, string>();
  for (const file of files) {
    if (/\.csv$/i.test(file.path)) csvToDatabase.set(file.path, databaseBase(file.path));
  }

  const pdfs = new Map<string, SourceFile>();
  for (const file of files) {
    const { extension } = splitExtension(lastSegment(file.path));
    if (extension === ".csv") continue;
    if (extension === ".md") {
      if (file.size > MARKDOWN_MAX_BYTES) skipped.push({ path: file.path, reason: "5MB를 넘는 문서" });
      else pages.set(file.path, file);
    } else if (IMAGE_EXTENSIONS.has(extension)) images.set(file.path, file);
    else if (extension === ".pdf") {
      if (file.size > PDF_MAX_BYTES) skipped.push({ path: file.path, reason: "100MB를 넘는 PDF" });
      else if (!hasPdfMagic(file.readHead ? file.readHead(PDF_MAGIC.length) : file.read().slice(0, PDF_MAGIC.length))) {
        skipped.push({ path: file.path, reason: "PDF 형식이 아닌 파일" });
      } else pdfs.set(file.path, file);
    } else skipped.push({ path: file.path, reason: "PDF·이미지가 아닌 첨부(PPTX 등)라 가져오지 않음" });
  }

  // 데이터베이스 행 페이지: 행 폴더 바로 아래 페이지 중 CSV 첫 열(제목)과 맞는 것. 남는 페이지는 일반 하위 페이지다.
  const rowPageOf = new Map<string, Map<number, string>>();
  const rowPages = new Set<string>();
  for (const [base, file] of databases) {
    const directory = rowDirectoryOf.get(base);
    if (!directory) continue;
    const unmatched = new Map<string, string[]>();
    for (const path of [...pages.keys()].sort((a, b) => a.localeCompare(b))) {
      if (dirname(path) !== directory) continue;
      const page = pages.get(path)!;
      const head = decodeText(page.readHead ? page.readHead(1024) : page.read().slice(0, 1024));
      const titles = [leadingTitle(head), cleanNotionName(splitExtension(lastSegment(path)).base)];
      for (const key of new Set(titles.filter((title): title is string => Boolean(title)).map(rowTitleKey))) {
        unmatched.set(key, [...(unmatched.get(key) ?? []), path]);
      }
    }
    const matched = new Map<number, string>();
    parseCsv(decodeText(file.read())).slice(1).forEach((cells, row) => {
      const candidates = unmatched.get(rowTitleKey(cells[0] ?? "")) ?? [];
      const path = candidates.find((candidate) => !rowPages.has(candidate));
      if (!path) return;
      rowPages.add(path);
      matched.set(row, path);
    });
    rowPageOf.set(base, matched);
  }

  // 문서가 들어 있는 폴더만 만든다(이미지뿐인 페이지 폴더는 만들지 않는다).
  const documentPaths = [...pages.keys(), ...[...databases.values()].map((file) => file.path), ...pdfs.keys()];
  const folderPaths = directoriesOf(documentPaths);
  // 하위 페이지가 있는 페이지: 같은 이름 폴더 옆에 둔다. 폴더 하나에 페이지 하나만 짝짓는다.
  const indexPageOf = new Map<string, string>();
  for (const path of [...pages.keys()].sort((a, b) => a.localeCompare(b))) {
    const directory = childDirectoryOf(path.replace(/\.md$/i, ""), allDirectories);
    if (!directory || indexPageOf.has(directory)) continue;
    if (documentPaths.some((other) => other !== path && other.startsWith(`${directory}/`))) {
      folderPaths.add(directory);
      indexPageOf.set(directory, path);
    }
  }
  // 행 폴더도 같은 규칙: 표 문서 옆에 같은 이름 폴더를 두고 행 페이지를 그 안에 넣는다.
  for (const [base, directory] of rowDirectoryOf) {
    const file = databases.get(base)!;
    if (indexPageOf.has(directory) || !documentPaths.some((other) => other.startsWith(`${directory}/`))) continue;
    folderPaths.add(directory);
    indexPageOf.set(directory, file.path);
  }

  const sortedFolders = [...folderPaths].sort((a, b) => (a.split("/").length - b.split("/").length) || a.localeCompare(b));
  const folderNamesTaken = new Map<string | null, Set<string>>([[null, new Set([...existing.folders].map(nameKey))]]);
  const documentNamesTaken = new Map<string | null, Set<string>>([[null, new Set([...existing.documents].map(nameKey))]]);
  const takenIn = (map: Map<string | null, Set<string>>, key: string | null) => {
    let set = map.get(key);
    if (!set) { set = new Set(); map.set(key, set); }
    return set;
  };

  const folders: PlanFolder[] = [];
  const documentNames = new Map<string, { name: string; folderKey: string | null }>();
  for (const path of sortedFolders) {
    const parentKey = dirname(path) || null;
    const indexPage = indexPageOf.get(path);
    const folderTaken = takenIn(folderNamesTaken, parentKey);
    if (!indexPage) {
      folders.push({ key: path, name: uniqueName(cleanNotionName(lastSegment(path)), folderTaken), parentKey });
      continue;
    }
    // 페이지 문서와 폴더는 같은 부모에 같은 이름으로 둔다. 문서는 문서끼리, 폴더는 폴더끼리만 겹치면 안 되므로 둘 다 비는 이름을 고른다.
    const name = uniqueNameAcross(cleanNotionName(lastSegment(path)), [folderTaken, takenIn(documentNamesTaken, parentKey)]);
    folders.push({ key: path, name, parentKey, pageDocumentKey: indexPage });
    documentNames.set(indexPage, { name, folderKey: parentKey });
  }
  for (const path of [...documentPaths].sort((a, b) => a.localeCompare(b))) {
    if (documentNames.has(path)) continue;
    const folderKey = dirname(path) || null;
    const base = /\.csv$/i.test(path) ? lastSegment(databaseBase(path)) : splitExtension(lastSegment(path)).base;
    // PDF도 확장자를 뗀 이름으로 겹침을 피한다. 변환본(<이름>.md)이 같은 폴더 문서와 겹치지 않게 한다.
    const name = uniqueName(cleanNotionName(base), takenIn(documentNamesTaken, folderKey));
    documentNames.set(path, { name: pdfs.has(path) ? `${name}.pdf` : name, folderKey });
  }

  const allPaths = new Set(files.map((file) => file.path));
  // 페이지 → 그 하위 페이지 폴더, 폴더 → 바로 아래 문서(이름순)
  const pageFolderOf = new Map([...indexPageOf].map(([directory, page]) => [page, directory]));
  const childrenOf = (folderKey: string | undefined) => folderKey === undefined ? [] : [...documentNames]
    .filter(([, named]) => named.folderKey === folderKey)
    .map(([key, named]) => ({ key, name: named.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  // Notion 페이지 id → 가져오는 문서 key. 절대 링크(notion.so·app.notion.com)를 앱 문서로 잇는다.
  const documentKeyById = new Map<string, string>();
  for (const [path, file] of [...pages, ...[...databases.values()].map((database) => [database.path, database] as const)]) {
    if (!documentNames.has(file.path)) continue;
    const base = /\.csv$/i.test(path) ? lastSegment(databaseBase(path)) : splitExtension(lastSegment(path)).base;
    const id = /\s([0-9a-f]{32})$/i.exec(base.normalize("NFC"))?.[1].toLowerCase();
    if (id && !documentKeyById.has(id)) documentKeyById.set(id, file.path);
  }
  let notionLinkCount = 0;
  const imageInfo = new Map<string, ImageInfo>();
  const inspectImage = (path: string): ImageInfo | null => {
    const cached = imageInfo.get(path);
    if (cached) return cached;
    const file = images.get(path);
    if (!file) return null;
    const mime = file.size > ATTACHMENT_MAX_BYTES ? null : sniffImageMime(file.readHead ? file.readHead(16) : file.read().slice(0, 16));
    const info = { size: file.size, mime, read: file.read };
    imageInfo.set(path, info);
    return info;
  };

  const brokenLinks: ImportPlan["brokenLinks"] = [];
  const referencedImages = new Set<string>();
  const documents: PlanDocument[] = [];
  let tableCount = 0;

  /** path 문서 안 링크의 대상. 가져오는 문서·PDF는 문서 링크, 이미지는 첨부, 나머지는 글자만 남긴다. */
  const resolverFor = (path: string) => (target: string, isImage: boolean): LinkTarget => {
    if ((pages.has(target) || pdfs.has(target)) && documentNames.has(target)) return { kind: "document", key: target };
    const database = csvToDatabase.get(target);
    if (database !== undefined) {
      const databaseFile = databases.get(database);
      if (databaseFile && documentNames.has(databaseFile.path)) return { kind: "document", key: databaseFile.path };
    }
    if (isImage) {
      const info = inspectImage(target);
      if (info?.mime) return { kind: "image", path: target };
    }
    if (!allPaths.has(target)) brokenLinks.push({ documentKey: path, href: target });
    return { kind: "broken" };
  };

  for (const [base, file] of databases) {
    const named = documentNames.get(file.path);
    if (!named) continue;
    // 제목 칸은 그 행 문서로, 다른 칸의 관계·Notion 링크는 Markdown 링크로 바꾼 뒤 본문 링크와 같이 토큰으로 만든다.
    const rowPage = rowPageOf.get(base) ?? new Map<number, string>();
    const table = csvToMarkdownTable(decodeText(file.read()), (row, column, escaped) => {
      const page = column === 0 ? rowPage.get(row) : undefined;
      if (page && escaped && !/[[\]\\]/.test(escaped)) return `[${escaped}](${relativeHref(file.path, page)})`;
      return linkifyNotionReferences(escaped);
    });
    // 문서 이름은 편집기 위에 따로 보이므로 제목을 붙이지 않는다.
    const tokenized = tokenizeLinks(`${table}\n`, file.path, resolverFor(file.path), (id) => documentKeyById.get(id));
    notionLinkCount += tokenized.notionLinks;
    const bytes = byteLength(tokenized.markdown);
    if (bytes > MARKDOWN_MAX_BYTES) {
      skipped.push({ path: file.path, reason: "5MB를 넘는 표" });
      continue;
    }
    tableCount += 1;
    // 표 칸 안의 이미지는 첨부하지 않는다(글자만 남는다).
    documents.push({ key: file.path, name: named.name, folderKey: named.folderKey, kind: "table", markdown: tokenized.markdown.replace(/\u0000I\d+\u0000/g, ""), links: tokenized.links, images: [], bytes });
    await pause();
  }

  for (const [path, file] of pages) {
    const named = documentNames.get(path);
    if (!named) continue;
    const resolve = resolverFor(path);
    const isRow = rowPages.has(path);
    const titles = [named.name, cleanNotionName(splitExtension(lastSegment(path)).base)];
    const sanitized = sanitizeNotionMarkdown(decodeText(file.read()));
    // 파일 이름이 `:` 등을 공백으로 바꿔 제목과 달라도(`창업톤(L AUNCH)` ↔ `# 창업톤(L:AUNCH)`) 같은 제목으로 본다.
    const heading = leadingTitle(sanitized);
    if (heading && titles.some((title) => rowTitleKey(title) === rowTitleKey(heading))) titles.push(heading);
    const stripped = stripLeadingTitle(sanitized, titles);
    const body = isRow ? propertiesToTable(stripped) : stripped;
    const tokenized = appendChildLinks(tokenizeLinks(body, path, resolve, (id) => documentKeyById.get(id)), childrenOf(pageFolderOf.get(path)));
    notionLinkCount += tokenized.notionLinks;
    const bytes = byteLength(tokenized.markdown);
    if (bytes > MARKDOWN_MAX_BYTES) {
      skipped.push({ path, reason: "5MB를 넘는 문서" });
      continue;
    }
    const planImages: PlanImage[] = tokenized.images.map(({ path: imagePath, alt }) => {
      const info = imageInfo.get(imagePath)!;
      referencedImages.add(imagePath);
      return { path: imagePath, alt, size: info.size, mime: info.mime!, fileName: lastSegment(imagePath), read: info.read };
    });
    documents.push({ key: path, name: named.name, folderKey: named.folderKey, kind: isRow ? "row" : "page", markdown: tokenized.markdown, links: tokenized.links, images: planImages, bytes });
    await pause();
  }

  for (const [path, file] of images) {
    if (referencedImages.has(path)) continue;
    const info = inspectImage(path);
    if (file.size > ATTACHMENT_MAX_BYTES) skipped.push({ path, reason: "10MB를 넘는 이미지" });
    else if (!info?.mime) skipped.push({ path, reason: "PNG·JPEG·GIF·WebP가 아닌 이미지" });
    else skipped.push({ path, reason: "본문에서 쓰지 않는 이미지" });
  }

  // 건너뛴 문서를 가리키던 폴더 계획은 그대로 둔다(폴더 안 다른 문서가 있을 수 있다). 빈 폴더만 뺀다.
  const planPdfs: PlanPdf[] = [...pdfs.values()].sort((a, b) => a.path.localeCompare(b.path)).map((file) => {
    const named = documentNames.get(file.path)!;
    return { key: file.path, name: named.name, folderKey: named.folderKey, size: file.size, read: file.read };
  });
  const usedFolders = new Set<string>();
  for (const document of [...documents, ...planPdfs]) {
    for (let key = document.folderKey; key; key = dirname(key) || null) usedFolders.add(key);
  }
  const keptFolders = folders.filter((folder) => usedFolders.has(folder.key));

  documents.sort((a, b) => a.key.localeCompare(b.key));
  const imageCount = documents.reduce((sum, document) => sum + document.images.length, 0);
  const totalBytes = documents.reduce((sum, document) => sum + document.bytes + document.images.reduce((total, image) => total + image.size, 0), 0)
    + planPdfs.reduce((sum, pdf) => sum + pdf.size, 0);
  return {
    folders: keptFolders,
    documents,
    pdfs: planPdfs,
    skipped,
    brokenLinks,
    notionLinkCount,
    rowPageCount: documents.filter((document) => document.kind === "row").length,
    tableCount,
    imageCount,
    totalBytes,
    itemCount: documents.length + imageCount + planPdfs.length
  };
}
