/**
 * Notion "Markdown & CSV" 내보내기 파일 목록을 Fruition 폴더·문서 계획으로 바꾼다(서버에 쓰기 전 미리보기 겸 실행 계획).
 *
 * 매핑 규칙
 * - `페이지 <id>.md` → 문서 "페이지". 같은 이름의 폴더(`페이지 <id>/` 또는 id 없는 `페이지/`)에 하위 페이지가 있으면
 *   Obsidian처럼 문서 "페이지" 옆(같은 부모)에 폴더 "페이지"를 만들고 하위 페이지는 그 폴더에 둔다.
 *   부모 본문이 링크하지 않은 하위 페이지는 본문 끝 "하위 페이지" 목록에 링크로 붙인다.
 * - `DB <id>.csv`(`_all.csv`가 있으면 그쪽) → GFM 표 문서 하나. 행 폴더(`DB <id>/` 또는 `DB/`)의 행 페이지는 가져오지 않는다.
 * - 이름 끝 ` <32 hex>`를 떼고 NFC로 맞춘 뒤, 같은 폴더 안 중복은 ` (2)`로 피한다.
 * - 이미지는 본문에서 참조할 때만 그 문서의 첨부로 올린다(PNG·JPEG·GIF·WebP, 매직 바이트로 확인).
 */
import { csvToMarkdownTable } from "./csvTable";
import { sniffImageMime, type ImageMime } from "./imageSniff";
import { sanitizeNotionMarkdown } from "./notionHtml";
import { dirname, tokenizeLinks, type LinkTarget, type RewrittenLinks } from "./notionLinks";
import { cleanNotionName, nameKey, splitExtension, uniqueName } from "./notionNames";
import { ATTACHMENT_MAX_BYTES } from "./attachmentBatches";

const MIB = 1024 * 1024;
/** 서버 Markdown 본문 상한(UTF-8) */
export const MARKDOWN_MAX_BYTES = 5 * MIB;

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
  kind: "page" | "table";
  /** 링크·이미지가 토큰으로 남은 본문 */
  markdown: string;
  links: RewrittenLinks["links"];
  images: PlanImage[];
  /** 토큰을 채우기 전 본문 바이트(UTF-8) */
  bytes: number;
};

export type SkippedItem = { path: string; reason: string };

export type ImportPlan = {
  /** 상위 폴더가 먼저 오는 순서 */
  folders: PlanFolder[];
  documents: PlanDocument[];
  skipped: SkippedItem[];
  /** zip 안에 없는 대상을 가리켜 글자만 남긴 링크 */
  brokenLinks: { documentKey: string; href: string }[];
  /** 앱 문서 링크로 바꾼 Notion 절대 링크 수 */
  notionLinkCount: number;
  /** 가져오지 않은 데이터베이스 행 페이지 수 */
  skippedRowPages: number;
  tableCount: number;
  imageCount: number;
  /** 문서 본문 + 이미지 바이트 */
  totalBytes: number;
  /** 문서 + 이미지 수(서버 item_count) */
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
  const rowDirectories = [...rowDirectoryOf.values()].map((directory) => `${directory}/`);
  const csvToDatabase = new Map<string, string>();
  for (const file of files) {
    if (/\.csv$/i.test(file.path)) csvToDatabase.set(file.path, databaseBase(file.path));
  }

  let skippedRowPages = 0;
  for (const file of files) {
    const { extension } = splitExtension(lastSegment(file.path));
    if (extension === ".csv") continue;
    if (rowDirectories.some((directory) => file.path.startsWith(directory))) {
      if (extension === ".md") skippedRowPages += 1;
      else skipped.push({ path: file.path, reason: "데이터베이스 행 페이지의 첨부" });
      continue;
    }
    if (extension === ".md") {
      if (file.size > MARKDOWN_MAX_BYTES) skipped.push({ path: file.path, reason: "5MB를 넘는 문서" });
      else pages.set(file.path, file);
    } else if (IMAGE_EXTENSIONS.has(extension)) images.set(file.path, file);
    else skipped.push({ path: file.path, reason: "지원하지 않는 첨부 파일" });
  }

  // 문서가 들어 있는 폴더만 만든다(이미지뿐인 페이지 폴더는 만들지 않는다).
  const documentPaths = [...pages.keys(), ...[...databases.values()].map((file) => file.path)];
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
    documentNames.set(path, { name: uniqueName(cleanNotionName(base), takenIn(documentNamesTaken, folderKey)), folderKey });
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

  for (const [path, file] of databases) {
    const named = documentNames.get(file.path);
    if (!named) continue;
    const rowDirectory = rowDirectoryOf.get(path);
    const rows = Boolean(rowDirectory) && files.some((entry) => entry.path.startsWith(`${rowDirectory}/`) && /\.md$/i.test(entry.path));
    const table = csvToMarkdownTable(decodeText(file.read()));
    const note = rows ? "\n\n> Notion 데이터베이스의 표만 가져왔어요. 각 행의 페이지 본문은 가져오지 않았어요." : "";
    // 문서 이름은 편집기 위에 따로 보이므로 제목을 붙이지 않는다.
    const markdown = `${table}${note}\n`;
    const bytes = byteLength(markdown);
    if (bytes > MARKDOWN_MAX_BYTES) {
      skipped.push({ path: file.path, reason: "5MB를 넘는 표" });
      continue;
    }
    tableCount += 1;
    documents.push({ key: file.path, name: named.name, folderKey: named.folderKey, kind: "table", markdown, links: [], images: [], bytes });
    await pause();
  }

  for (const [path, file] of pages) {
    const named = documentNames.get(path);
    if (!named) continue;
    const resolve = (target: string, isImage: boolean): LinkTarget => {
      if (pages.has(target) && documentNames.has(target)) return { kind: "document", key: target };
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
    const titles = [named.name, cleanNotionName(splitExtension(lastSegment(path)).base)];
    const body = stripLeadingTitle(sanitizeNotionMarkdown(decodeText(file.read())), titles);
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
    documents.push({ key: path, name: named.name, folderKey: named.folderKey, kind: "page", markdown: tokenized.markdown, links: tokenized.links, images: planImages, bytes });
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
  const usedFolders = new Set<string>();
  for (const document of documents) {
    for (let key = document.folderKey; key; key = dirname(key) || null) usedFolders.add(key);
  }
  const keptFolders = folders.filter((folder) => usedFolders.has(folder.key));

  documents.sort((a, b) => a.key.localeCompare(b.key));
  const imageCount = documents.reduce((sum, document) => sum + document.images.length, 0);
  const totalBytes = documents.reduce((sum, document) => sum + document.bytes + document.images.reduce((total, image) => total + image.size, 0), 0);
  return {
    folders: keptFolders,
    documents,
    skipped,
    brokenLinks,
    notionLinkCount,
    skippedRowPages,
    tableCount,
    imageCount,
    totalBytes,
    itemCount: documents.length + imageCount
  };
}
