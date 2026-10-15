// 약관·처리방침 관련 상수. 약관 페이지(/terms)와 가입 동의 요청이 같은 버전을 쓴다.
// 서버 설정 LEGAL_TERMS_VERSION(기본 2026-10-01)과 정확히 같아야 가입·재동의가 받아들여진다.
export const LEGAL_TERMS_VERSION = "2026-10-01";

export const TERMS_PATH = "/terms";
export const PRIVACY_PATH = "/privacy";

// /terms·/privacy 공개 페이지 노출 여부. 법률 확정본·운영자 정보가 나오기 전까지 기본은 꺼짐이고, 꺼져 있으면 두 경로가 404다.
// NEXT_PUBLIC_ 값은 빌드 때 고정되므로 바꾸면 다시 빌드한다.
export const LEGAL_PAGES_ENABLED = process.env.NEXT_PUBLIC_LEGAL_PAGES_ENABLED === "true";
