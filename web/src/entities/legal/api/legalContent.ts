// 저장소 content/legal 디렉터리에서 약관·처리방침 Markdown을 읽는다. 서버 컴포넌트에서만 import한다.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  isLegalVersion,
  legalBodyFileName,
  legalChangesFileName,
  listLegalVersions,
  previousLegalVersion,
  resolveLegalVersion,
  type LegalDocumentSlug,
  type LegalVersion
} from "../model/legalDocuments";

const CONTENT_ROOT = path.join(process.cwd(), "content", "legal");

export type LegalDocumentContent = {
  versions: LegalVersion[];
  version: LegalVersion;
  previous: LegalVersion | null;
  markdown: string;
  /** 이전 버전과의 변경 비교표 Markdown. 파일이 없으면 null */
  changesMarkdown: string | null;
};

/** 요청 버전(없거나 잘못되면 최신)의 본문과 버전 목록을 읽는다. 문서 디렉터리가 비어 있으면 null. */
export async function loadLegalDocument(slug: LegalDocumentSlug, requestedVersion: unknown): Promise<LegalDocumentContent | null> {
  const directory = path.join(CONTENT_ROOT, slug);
  const versions = listLegalVersions(await readdir(directory));
  const version = resolveLegalVersion(versions, requestedVersion);
  if (!version || !isLegalVersion(version.effectiveDate)) return null;

  const markdown = await readFile(path.join(directory, legalBodyFileName(version.effectiveDate)), "utf8");
  const changesMarkdown = version.hasChanges
    ? await readFile(path.join(directory, legalChangesFileName(version.effectiveDate)), "utf8")
    : null;
  return { versions, version, previous: previousLegalVersion(versions, version), markdown, changesMarkdown };
}
