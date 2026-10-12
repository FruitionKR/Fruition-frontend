// 이용약관·개인정보 처리방침의 버전 식별과 목록 정리(이슈 #130). 순수 함수만 두어 node:test로 검증한다.
// 본문은 저장소의 content/legal/<slug>/<시행일>.md 에 두고, 시행일(YYYY-MM-DD)이 곧 버전 식별자다.
// 같은 디렉터리의 <시행일>.changes.md 는 그 버전이 이전 버전에서 무엇을 바꿨는지 비교한 표(선택)다.

import { LEGAL_TERMS_VERSION, PRIVACY_PATH, TERMS_PATH } from "@/shared/config/legal";

/**
 * 현재 시행 중인 약관 버전은 가입 동의(#128)와 같은 값을 써야 하므로 shared/config/legal.ts 한 곳에 둔다.
 * 새 버전을 시행하면 Markdown 파일을 추가하고 그 값을 함께 올린다.
 */
export { LEGAL_TERMS_VERSION };
/** 현재 시행 중인 개인정보 처리방침 버전. access-svc `app.legal.privacy-version`과 같은 값이어야 한다. */
export const LEGAL_PRIVACY_VERSION = "2026-10-01";

export type LegalDocumentSlug = "terms" | "privacy";

export type LegalDocumentMeta = {
  slug: LegalDocumentSlug;
  /** 공개 경로. 로그인·접근 코드 없이 열린다(middleware는 /api만 막는다). */
  path: `/${LegalDocumentSlug}`;
  title: string;
  currentVersion: string;
};

export const LEGAL_DOCUMENTS: Record<LegalDocumentSlug, LegalDocumentMeta> = {
  terms: { slug: "terms", path: TERMS_PATH, title: "이용약관", currentVersion: LEGAL_TERMS_VERSION },
  privacy: { slug: "privacy", path: PRIVACY_PATH, title: "개인정보 처리방침", currentVersion: LEGAL_PRIVACY_VERSION }
};

/**
 * 하단 운영자 정보. 사업자등록·통신판매업 신고 뒤에 채운다(전자상거래법 제10조①).
 * 값이 PENDING_VALUE면 화면에 "[확정 필요]"로 눈에 띄게 표시한다.
 */
export const OPERATOR_INFO_PENDING = "[확정 필요]";

export const OPERATOR_INFO: readonly { label: string; value: string }[] = [
  { label: "상호", value: OPERATOR_INFO_PENDING },
  { label: "대표자", value: OPERATOR_INFO_PENDING },
  { label: "사업자등록번호", value: OPERATOR_INFO_PENDING },
  { label: "통신판매업 신고번호", value: OPERATOR_INFO_PENDING },
  { label: "주소", value: OPERATOR_INFO_PENDING },
  { label: "연락처", value: OPERATOR_INFO_PENDING },
  { label: "개인정보 보호책임자(CPO)", value: OPERATOR_INFO_PENDING }
];

export type LegalVersion = {
  /** 시행일 = 버전 식별자(YYYY-MM-DD) */
  effectiveDate: string;
  /** 이전 버전과의 변경 비교표(<시행일>.changes.md)가 있는지 */
  hasChanges: boolean;
};

const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BODY_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.md$/;
const CHANGES_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.changes\.md$/;

/** 쿼리로 들어온 버전 문자열이 시행일 형식인지. 파일 경로에 넣기 전에 반드시 거친다(경로 조작 방지). */
export function isLegalVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

/** 디렉터리 파일명 목록을 시행일 내림차순(최신 먼저) 버전 목록으로 만든다. 본문 .md가 없는 changes 파일은 무시한다. */
export function listLegalVersions(fileNames: readonly string[]): LegalVersion[] {
  const changes = new Set(
    fileNames.flatMap((name) => {
      const match = CHANGES_FILE_PATTERN.exec(name);
      return match ? [match[1]] : [];
    })
  );
  return fileNames
    .flatMap((name) => {
      const match = BODY_FILE_PATTERN.exec(name);
      return match ? [match[1]] : [];
    })
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((effectiveDate) => ({ effectiveDate, hasChanges: changes.has(effectiveDate) }));
}

/**
 * 요청한 버전을 목록에서 고른다. 요청이 없거나 형식이 틀리거나 목록에 없으면 최신 버전으로 돌아간다.
 * 목록이 비어 있으면 null.
 */
export function resolveLegalVersion(versions: readonly LegalVersion[], requested: unknown): LegalVersion | null {
  if (versions.length === 0) return null;
  if (!isLegalVersion(requested)) return versions[0];
  return versions.find((version) => version.effectiveDate === requested) ?? versions[0];
}

/** 선택한 버전 바로 이전에 시행된 버전(비교표의 "변경 전"). 가장 오래된 버전이면 null. */
export function previousLegalVersion(versions: readonly LegalVersion[], current: LegalVersion): LegalVersion | null {
  const index = versions.findIndex((version) => version.effectiveDate === current.effectiveDate);
  return index >= 0 ? versions[index + 1] ?? null : null;
}

/** 공개 페이지 본문·비교표 파일명 */
export function legalBodyFileName(effectiveDate: string): string {
  return `${effectiveDate}.md`;
}

export function legalChangesFileName(effectiveDate: string): string {
  return `${effectiveDate}.changes.md`;
}
