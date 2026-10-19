// 약관·처리방침 관련 상수. 약관 페이지(/terms)와 가입 동의 요청이 같은 버전을 쓴다.
// 서버 설정 LEGAL_TERMS_VERSION(기본 2026-10-01)과 정확히 같아야 가입·재동의가 받아들여진다.
export const LEGAL_TERMS_VERSION = "2026-10-01";

export const TERMS_PATH = "/terms";
export const PRIVACY_PATH = "/privacy";

// 법률 출시 스위치. /terms·/privacy 공개 페이지와 약관 동의 UI(가입 화면 동의 항목, 소셜 가입 동의 화면, 재동의 화면)를 함께 켜고 끈다.
// 법률 확정본·운영자 정보가 나오기 전까지 기본은 꺼짐이고, 꺼져 있으면 두 경로가 404이며 가입 요청에 동의 필드를 보내지 않는다.
// access 서버 LEGAL_CONSENT_REQUIRED(app.legal.consent-required)와 반드시 맞춘다: 꺼짐 ⇔ LEGAL_CONSENT_REQUIRED=false.
// 어긋나면(프론트 꺼짐·서버 true) 가입이 400 CONSENT_REQUIRED로 거절된다.
// NEXT_PUBLIC_ 값은 빌드 때 고정되므로 바꾸면 다시 빌드한다.
export const LEGAL_PAGES_ENABLED = process.env.NEXT_PUBLIC_LEGAL_PAGES_ENABLED === "true";
