/**
 * 업로드로 들어온 파일을 Markdown 묶음 파일로 바꾼다. 고른 파일은 그대로, zip은 Notion 가져오기와 같은 안전 검사
 * (경로·심볼릭 링크·압축률·개수·크기)를 거쳐 푼다. Notion 내보내기 모양의 zip은 호출자가 Notion 가져오기로 보낸다.
 */
import { readZipArchive } from "@/shared/lib/markdown-import/zipArchive";
import { fileBundlePath, isImagePath, isMarkdownPath, looksLikeNotionExport, type BundleFile } from "../lib/markdownBundle";

export const isZipFile = (file: File) => /\.zip$/i.test(file.name);

export function bundleFilesFromSelection(files: readonly File[]): BundleFile[] {
  return files
    .filter((file) => isMarkdownPath(file.name) || isImagePath(file.name))
    .map((file) => ({
      path: fileBundlePath(file),
      size: file.size,
      read: () => file.arrayBuffer().then((buffer) => new Uint8Array(buffer))
    }));
}

export type ZipBundle = { kind: "notion" } | { kind: "bundle"; files: BundleFile[] };

/** zip을 읽는다. 안전 검사에 걸리면 ZipSafetyError를 던진다. Markdown·그림이 아닌 항목은 쓰지 않는다. */
export async function bundleFromZip(file: File): Promise<ZipBundle> {
  const { entries } = await readZipArchive(new Uint8Array(await file.arrayBuffer()));
  if (looksLikeNotionExport(entries.map((entry) => entry.path))) return { kind: "notion" };
  return {
    kind: "bundle",
    files: entries
      .filter((entry) => isMarkdownPath(entry.path) || isImagePath(entry.path))
      .map((entry) => ({ path: entry.path, size: entry.size, read: async () => entry.read() }))
  };
}
