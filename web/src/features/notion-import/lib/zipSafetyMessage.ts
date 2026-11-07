import { MAX_ENTRY_COUNT, type ZipSafetyError } from "@/shared/lib/markdown-import/zipArchive";
import type { NotionImportTranslate } from "./notionImportTranslate";

/** zip 안전 검사 실패 문구. ZipSafetyError의 message(한국어) 대신 종류(kind)로 지금 언어 문구를 고른다. */
export function describeZipSafetyError(error: Pick<ZipSafetyError, "kind" | "path">, t: NotionImportTranslate): string {
  return t(`zipSafety.${error.kind}`, { path: error.path ?? "", count: MAX_ENTRY_COUNT });
}
