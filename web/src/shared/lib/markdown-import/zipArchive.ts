/**
 * Notion 내보내기 zip을 브라우저에서 안전하게 읽는다.
 * 중앙 디렉터리만 먼저 읽어 경로·개수·크기·압축률을 검사하고, 본문은 필요할 때 항목별로 푼다(fflate inflateSync).
 * Web Worker 대신 항목 사이에 메인 스레드를 양보한다(CSP script-src 'strict-dynamic'이라 blob worker를 쓰지 않는다).
 * 테스트가 그대로 불러 쓰도록 fflate 외에는 import하지 않는다.
 */
import { Inflate, inflateSync } from "fflate";

const GIB = 1024 * 1024 * 1024;

/** 압축 해제 합계 상한 */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 2 * GIB;
/** 항목 수 상한(중첩 zip 안 항목 포함) */
export const MAX_ENTRY_COUNT = 10_000;
/** 항목별 압축률 상한 */
export const MAX_COMPRESSION_RATIO = 100;
/**
 * 압축률은 이 크기를 넘는 항목에만 본다. 빈 칸이 많은 작은 CSV처럼 몇 KB짜리 정상 파일도 100:1을 넘을 수 있고,
 * 이 크기 이하로는 압축 폭탄이 될 수 없다.
 */
export const COMPRESSION_RATIO_MIN_BYTES = 1024 * 1024;

/** 안전 검사에 걸린 종류. 화면은 message(한국어) 대신 이 값으로 지금 언어 문구를 고를 수 있다. */
export type ZipSafetyKind =
  | "unreadable"
  | "zip64"
  | "tooManyEntries"
  | "corrupt"
  | "corruptEntry"
  | "unsafePath"
  | "symlink"
  | "encrypted"
  | "unsupportedMethod"
  | "compressionRatio"
  | "sizeMismatch"
  | "tooLarge";

export class ZipSafetyError extends Error {
  readonly kind: ZipSafetyKind;
  /** 문제가 된 zip 안 경로(항목별 검사일 때만) */
  readonly path?: string;

  constructor(message: string, kind: ZipSafetyKind, path?: string) {
    super(message);
    this.name = "ZipSafetyError";
    this.kind = kind;
    this.path = path;
  }
}

export type ZipEntry = {
  /** NFC로 정규화한 zip 안 경로. 중첩 zip 항목도 바깥 zip 기준이 아니라 안쪽 zip 기준 경로다. */
  path: string;
  compressedSize: number;
  size: number;
  /** 본문을 푼다. 선언한 크기와 실제 크기가 다르면 던진다. */
  read: () => Uint8Array;
  /** 앞 length바이트만 푼다(이미지 형식 확인용). 전체를 메모리에 풀지 않는다. */
  readHead: (length: number) => Uint8Array;
};

type RawEntry = {
  path: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  isDirectory: boolean;
  isSymlink: boolean;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const MADE_BY_UNIX = 3;

const utf8 = new TextDecoder("utf-8");

function findEndOfCentralDirectory(view: DataView): number {
  // EOCD는 22바이트 + 주석(최대 65535바이트)이다.
  const minOffset = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new ZipSafetyError("zip 파일을 읽을 수 없어요. Notion에서 내보낸 zip 파일인지 확인해 주세요.", "unreadable");
}

/** 경로가 zip 밖을 가리키거나 절대 경로면 true */
export function isUnsafeZipPath(path: string): boolean {
  if (!path || path.includes("\0")) return true;
  if (path.startsWith("/") || path.startsWith("\\") || /^[a-zA-Z]:/.test(path)) return true;
  return path.split(/[\\/]/).some((segment) => segment === "..");
}

function readCentralDirectory(bytes: Uint8Array): RawEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || directoryOffset === ZIP64_MARKER) {
    throw new ZipSafetyError("4GB를 넘는 zip(ZIP64)은 아직 가져올 수 없어요. Notion에서 나눠서 내보내 주세요.", "zip64");
  }
  if (entryCount > MAX_ENTRY_COUNT) throw new ZipSafetyError(`zip 안 파일이 ${MAX_ENTRY_COUNT.toLocaleString()}개를 넘어 가져올 수 없어요.`, "tooManyEntries");
  const entries: RawEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new ZipSafetyError("zip 파일이 손상되었어요.", "corrupt");
    }
    const madeBy = view.getUint16(offset + 4, true) >> 8;
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    if (compressedSize === ZIP64_MARKER || size === ZIP64_MARKER || localHeaderOffset === ZIP64_MARKER) {
      throw new ZipSafetyError("4GB를 넘는 zip(ZIP64)은 아직 가져올 수 없어요. Notion에서 나눠서 내보내 주세요.", "zip64");
    }
    const rawName = utf8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const path = rawName.normalize("NFC");
    const unixMode = externalAttributes >>> 16;
    entries.push({
      path,
      method,
      flags,
      compressedSize,
      size,
      localHeaderOffset,
      isDirectory: path.endsWith("/"),
      isSymlink: madeBy === MADE_BY_UNIX && (unixMode & S_IFMT) === S_IFLNK
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 중앙 디렉터리 항목 하나의 안전 검사. 문제가 있으면 zip 전체를 거절한다. */
export function assertSafeEntry(entry: Pick<RawEntry, "path" | "flags" | "method" | "compressedSize" | "size" | "isSymlink">): void {
  if (isUnsafeZipPath(entry.path)) throw new ZipSafetyError(`zip 밖을 가리키는 경로가 있어 가져올 수 없어요: ${entry.path}`, "unsafePath", entry.path);
  if (entry.isSymlink) throw new ZipSafetyError(`심볼릭 링크가 들어 있어 가져올 수 없어요: ${entry.path}`, "symlink", entry.path);
  if (entry.flags & 0x1) throw new ZipSafetyError("암호가 걸린 zip은 가져올 수 없어요.", "encrypted");
  if (entry.method !== 0 && entry.method !== 8) throw new ZipSafetyError(`지원하지 않는 압축 방식이에요: ${entry.path}`, "unsupportedMethod", entry.path);
  if (entry.size > COMPRESSION_RATIO_MIN_BYTES && entry.size > Math.max(1, entry.compressedSize) * MAX_COMPRESSION_RATIO) {
    throw new ZipSafetyError(`압축률이 비정상적으로 높은 파일이 있어 가져올 수 없어요: ${entry.path}`, "compressionRatio", entry.path);
  }
}

function compressedData(bytes: Uint8Array, entry: RawEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = entry.localHeaderOffset;
  if (local + 30 > view.byteLength || view.getUint32(local, true) !== LOCAL_SIGNATURE) {
    throw new ZipSafetyError(`zip 파일이 손상되었어요: ${entry.path}`, "corruptEntry", entry.path);
  }
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength) throw new ZipSafetyError(`zip 파일이 손상되었어요: ${entry.path}`, "corruptEntry", entry.path);
  return bytes.subarray(start, end);
}

const HEAD_CHUNK_BYTES = 4096;

function headReader(bytes: Uint8Array, entry: RawEntry): (length: number) => Uint8Array {
  return (length) => {
    const data = compressedData(bytes, entry);
    if (entry.method === 0) return data.slice(0, length);
    // 압축 데이터를 조금씩 밀어 넣고 앞부분이 모이면 멈춘다.
    const chunks: Uint8Array[] = [];
    let collected = 0;
    const inflater = new Inflate((chunk) => { chunks.push(chunk); collected += chunk.length; });
    for (let offset = 0; offset < data.length && collected < length; offset += HEAD_CHUNK_BYTES) {
      const end = Math.min(data.length, offset + HEAD_CHUNK_BYTES);
      inflater.push(data.subarray(offset, end), end === data.length);
    }
    const head = new Uint8Array(Math.min(length, collected));
    let position = 0;
    for (const chunk of chunks) {
      if (position >= head.length) break;
      const part = chunk.subarray(0, head.length - position);
      head.set(part, position);
      position += part.length;
    }
    return head;
  };
}

function entryReader(bytes: Uint8Array, entry: RawEntry): () => Uint8Array {
  return () => {
    const data = compressedData(bytes, entry);
    if (entry.method === 0) {
      if (data.length !== entry.size) throw new ZipSafetyError(`zip 파일이 손상되었어요: ${entry.path}`, "corruptEntry", entry.path);
      return data;
    }
    // 선언한 크기만큼만 버퍼를 잡는다. 실제 크기가 다르면(헤더 위조) 거절한다.
    const out = inflateSync(data, { out: new Uint8Array(entry.size) });
    if (out.length !== entry.size) throw new ZipSafetyError(`압축 해제 크기가 맞지 않아요: ${entry.path}`, "sizeMismatch", entry.path);
    return out;
  };
}

const isNestedZip = (path: string) => /\.zip$/i.test(path);
const isIgnoredPath = (path: string) => path.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(path);

export type ZipReadResult = {
  entries: ZipEntry[];
  /** 두 단계 이상 중첩된 zip처럼 읽지 않고 건너뛴 경로 */
  skippedNestedZips: string[];
};

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * zip을 읽어 파일 항목 목록을 돌려준다. 최상위의 `*.zip`(Notion의 Export-…-Part-N.zip)은 한 단계만 풀어 합친다.
 * 안전 검사에 걸리면 ZipSafetyError를 던진다.
 */
export async function readZipArchive(bytes: Uint8Array): Promise<ZipReadResult> {
  const outer = readCentralDirectory(bytes);
  const entries: ZipEntry[] = [];
  const skippedNestedZips: string[] = [];
  let total = 0;
  let count = 0;

  function accept(raw: RawEntry, source: Uint8Array) {
    count += 1;
    if (count > MAX_ENTRY_COUNT) throw new ZipSafetyError(`zip 안 파일이 ${MAX_ENTRY_COUNT.toLocaleString()}개를 넘어 가져올 수 없어요.`, "tooManyEntries");
    total += raw.size;
    if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new ZipSafetyError("압축을 푼 크기가 2GB를 넘어 가져올 수 없어요.", "tooLarge");
    entries.push({ path: raw.path, compressedSize: raw.compressedSize, size: raw.size, read: entryReader(source, raw), readHead: headReader(source, raw) });
  }

  for (const raw of outer) {
    assertSafeEntry(raw);
    if (raw.isDirectory || isIgnoredPath(raw.path)) continue;
    if (!isNestedZip(raw.path)) {
      accept(raw, bytes);
      continue;
    }
    // 안쪽 zip 자체가 아니라 그 안의 파일을 합계에 넣는다. 안쪽 zip 하나가 상한을 넘으면 풀지 않는다.
    if (raw.size > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new ZipSafetyError("압축을 푼 크기가 2GB를 넘어 가져올 수 없어요.", "tooLarge");
    const nestedBytes = entryReader(bytes, raw)();
    await pause();
    for (const inner of readCentralDirectory(nestedBytes)) {
      assertSafeEntry(inner);
      if (inner.isDirectory || isIgnoredPath(inner.path)) continue;
      // 중첩은 한 단계까지만 푼다.
      if (isNestedZip(inner.path)) {
        skippedNestedZips.push(inner.path);
        continue;
      }
      accept(inner, nestedBytes);
    }
  }
  return { entries, skippedNestedZips };
}
