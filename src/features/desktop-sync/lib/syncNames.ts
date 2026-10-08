import { SUPPORTED_UPLOAD_EXTENSIONS } from "@/entities/document/lib/documentKind";

/** 서버는 중복이 아닐 때 이름을 NFC로 바꾸지 않으므로, macOS의 NFD 이름을 올리기 전에 맞춘다. */
export function normalizeSyncName(name: string): string {
  return name.trim().normalize("NFC");
}

/** 서버의 이름 중복 검사와 같은 기준(NFC·대소문자 무시)으로 비교한다. */
export function isSameSyncName(a: string, b: string): boolean {
  return normalizeSyncName(a).toLowerCase() === normalizeSyncName(b).toLowerCase();
}

/** 서버는 .txt를 .md 이름의 편집 문서로 저장한다. 로컬 이름은 그대로 두고 이 이름으로 짝짓는다. */
export function toServerFilename(localName: string): string {
  return normalizeSyncName(localName).replace(/\.txt$/i, ".md");
}

/**
 * 연결 폴더 기준 상대 파일 경로가 동기화 대상인지. 끝이 "/"면 폴더로 본다.
 * 숨김 파일·폴더(.fruition, .assets 등)는 앱이 관리하므로 제외한다.
 */
export function isSyncablePath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  const filename = normalizeSyncName(segments[segments.length - 1]).toLowerCase();
  if (!filename || segments.some((segment) => segment.startsWith("."))) return false;
  return SUPPORTED_UPLOAD_EXTENSIONS.some((extension) => filename.endsWith(extension));
}
