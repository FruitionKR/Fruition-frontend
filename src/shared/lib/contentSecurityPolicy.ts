// 앱 화면에 붙이는 CSP(이슈 #77). middleware가 요청마다 nonce를 넣어 강제(enforce)한다.

export const CSP_REPORT_PATH = "/csp-report";

// PDF 직접 업로드(S3 multipart PUT). CSP_S3_ORIGIN에 실제 버킷 오리진을 주면 그 오리진으로 좁힌다.
const DEFAULT_S3_ORIGIN = "https://*.amazonaws.com";

type ContentSecurityPolicyOptions = {
  /** 요청마다 새로 만든 값 */
  nonce: string;
  /** BACKEND_URL. 브라우저가 문서 API를 이 오리진으로 직접 부른다. */
  backendUrl?: string;
  /** CSP_S3_ORIGIN. 직접 업로드 버킷 오리진 */
  s3Origin?: string;
};

export function buildContentSecurityPolicy({ nonce, backendUrl, s3Origin }: ContentSecurityPolicyOptions): string {
  const backendOrigin = backendUrl ? new URL(backendUrl).origin : null;
  const s3 = s3Origin ? new URL(s3Origin).origin : DEFAULT_S3_ORIGIN;
  const directives = [
    ["default-src", "'self'"],
    // Next 인라인 부트스트랩 스크립트는 nonce로 허용하고, 그 스크립트가 넣는 청크는 'strict-dynamic'으로 이어받는다.
    // pdf.js wasm 디코더(JPX 등)가 메인 스레드에서 돌 때를 위해 wasm 컴파일만 허용한다(eval은 허용하지 않는다).
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'"],
    // KaTeX·편집기·pdf.js가 style 속성을 쓰므로 스타일은 인라인을 허용한다.
    ["style-src", "'self'", "'unsafe-inline'"],
    // 외부 이미지 차단의 핵심. 관리 이미지는 인증 fetch → blob:, 편집기 자리 표시는 data:로 그린다.
    ["img-src", "'self'", "data:", "blob:"],
    // KaTeX·Pretendard 폰트는 Next가 같은 출처(/_next/static, /fonts)로 서비스한다.
    ["font-src", "'self'", "data:"],
    ["connect-src", "'self'", ...(backendOrigin ? [backendOrigin] : []), s3],
    // pdf.js worker는 같은 출처(/_next/static/media)에서 받는다.
    ["worker-src", "'self'"],
    // PDF·텍스트가 아닌 원본 보기 iframe은 인증 fetch로 받은 blob:이다(S3 URL을 직접 열지 않는다).
    ["frame-src", "'self'", "blob:"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["report-uri", CSP_REPORT_PATH]
  ];
  return directives.map((directive) => directive.join(" ")).join("; ");
}
