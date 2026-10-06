// 앱 화면에 붙이는 CSP(이슈 #77). next.config.mjs가 빌드 시점에 읽으므로 TS가 아닌 .mjs로 둔다.
// 1단계는 Content-Security-Policy-Report-Only로 위반만 수집한다.

export const CSP_REPORT_PATH = "/csp-report";

// PDF 직접 업로드(S3 multipart PUT)와 원본 보기 iframe(S3 presigned GET). enforce 전에 실제 버킷 오리진으로 좁힌다.
const S3_ORIGINS = "https://*.amazonaws.com";

/**
 * @param {{ backendUrl?: string }} [options] backendUrl은 BACKEND_URL. 브라우저가 문서 API를 이 오리진으로 직접 부른다.
 * @returns {string}
 */
export function buildContentSecurityPolicy({ backendUrl } = {}) {
  const backendOrigin = backendUrl ? new URL(backendUrl).origin : null;
  const directives = [
    ["default-src", "'self'"],
    // Next가 넣는 인라인 부트스트랩 스크립트 때문에 지금은 'unsafe-inline'이 필요하다. enforce 전에 nonce로 바꾼다.
    ["script-src", "'self'", "'unsafe-inline'"],
    ["style-src", "'self'", "'unsafe-inline'"],
    // 외부 이미지 차단의 핵심. 관리 이미지는 인증 fetch → blob:, 편집기 자리 표시는 data:로 그린다.
    ["img-src", "'self'", "data:", "blob:"],
    // KaTeX·Pretendard 폰트는 Next가 같은 출처(/_next/static, /fonts)로 서비스한다.
    ["font-src", "'self'", "data:"],
    ["connect-src", "'self'", ...(backendOrigin ? [backendOrigin] : []), S3_ORIGINS],
    // 원본 PDF·파일 보기 iframe은 blob: 또는 S3 presigned URL이다.
    ["frame-src", "'self'", "blob:", S3_ORIGINS],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["report-uri", CSP_REPORT_PATH]
  ];
  return directives.map((directive) => directive.join(" ")).join("; ");
}
