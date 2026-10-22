// 앱 화면에 붙이는 CSP(이슈 #77). middleware가 요청마다 nonce를 넣어 강제(enforce)한다.

export const CSP_REPORT_PATH = "/csp-report";

// PDF·회의 녹음 직접 업로드(S3 multipart PUT)와 녹음 재생(presigned GET). CSP_S3_ORIGIN에 실제 버킷 오리진을 주면 그 오리진으로 좁힌다.
const DEFAULT_S3_ORIGIN = "https://*.amazonaws.com";

// 외부 이미지 차단의 핵심. 관리 이미지는 인증 fetch → blob:, 편집기 자리 표시는 data:로 그린다.
const IMAGE_SOURCES = ["'self'", "data:", "blob:"];

type ContentSecurityPolicyOptions = {
  /** 요청마다 새로 만든 값 */
  nonce: string;
  /** BACKEND_URL. 브라우저가 문서 API를 이 오리진으로 직접 부른다. */
  backendUrl?: string;
  /** CSP_S3_ORIGIN. 직접 업로드 버킷 오리진 */
  s3Origin?: string;
  /** 토큰이 있을 때만 PostHog US 수집·설정 도메인을 허용한다. */
  analyticsEnabled?: boolean;
};

// 요청마다 불리므로 같은 잘못된 값은 한 번만 로그를 남긴다.
const reportedInvalidOrigins = new Set<string>();

// 잘못된 env(스킴 없는 값 등) 하나로 모든 화면이 500이 되지 않도록 던지지 않고 null을 돌려준다.
function parseOrigin(name: string, value: string): string | null {
  try {
    const { origin } = new URL(value);
    if (origin !== "null") return origin;
  } catch {
    // 아래에서 한 번만 알린다
  }
  const key = `${name}=${value}`;
  if (!reportedInvalidOrigins.has(key)) {
    reportedInvalidOrigins.add(key);
    console.error(`[csp] ${name}가 올바른 URL이 아니라 CSP에서 무시한다: ${value}`);
  }
  return null;
}

/** https://api.example.com → wss://api.example.com (http는 ws) */
function toWebSocketOrigin(origin: string): string {
  return origin.replace(/^http(s?):/, "ws$1:");
}

export function buildContentSecurityPolicy({ nonce, backendUrl, s3Origin, analyticsEnabled = false }: ContentSecurityPolicyOptions): string {
  // 잘못된 BACKEND_URL은 출처를 빼고, 잘못된 CSP_S3_ORIGIN은 기본 S3 와일드카드로 돌아간다.
  const backendOrigin = backendUrl ? parseOrigin("BACKEND_URL", backendUrl) : null;
  const configuredS3 = s3Origin ? parseOrigin("CSP_S3_ORIGIN", s3Origin) : null;
  const s3 = configuredS3 ?? DEFAULT_S3_ORIGIN;
  // PDF 임시 읽기 URL은 지정한 저장소만 허용한다. 기본 AWS 와일드카드는 iframe에 쓰지 않는다.
  const frameStorage = configuredS3 && /^https?:\/\//.test(configuredS3) && !configuredS3.includes("*")
    ? [configuredS3] : [];
  const directives = [
    ["default-src", "'self'"],
    // Next 인라인 부트스트랩 스크립트는 nonce로 허용하고, 그 스크립트가 넣는 청크는 'strict-dynamic'으로 이어받는다.
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'"],
    // KaTeX·편집기가 style 속성을 쓰므로 스타일은 인라인을 허용한다.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", ...IMAGE_SOURCES],
    // KaTeX·Pretendard 폰트는 Next가 같은 출처(/_next/static, /fonts)로 서비스한다.
    ["font-src", "'self'", "data:"],
    // 회의 실시간 받아쓰기 WebSocket(#148)은 rewrite를 거치지 않고 문서 API 오리진에 ws(s)로 붙는다. 같은 오리진은 'self'가 허용한다.
    ["connect-src", "'self'", ...(backendOrigin ? [backendOrigin, toWebSocketOrigin(backendOrigin)] : []), s3,
      ...(analyticsEnabled ? ["https://us.i.posthog.com", "https://us-assets.i.posthog.com"] : [])],
    // 회의 녹음 재생(#148)은 <audio>가 recording-url의 S3 presigned GET 주소를 직접 연다. 지정하지 않으면 default-src 'self'로 막힌다.
    ["media-src", "'self'", s3],
    // PDF는 권한 검사를 거친 저장소 임시 URL 또는 인증 fetch로 받은 blob:으로 연다.
    ["frame-src", "'self'", "blob:", ...frameStorage],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["report-uri", CSP_REPORT_PATH]
  ];
  return directives.map((directive) => directive.join(" ")).join("; ");
}

/** CSP 헤더 값에서 script nonce를 꺼낸다. 없으면 undefined다(dev처럼 nonce 없는 img-src 전용 CSP만 붙는 경우). */
export function readCspNonce(policy: string | null | undefined): string | undefined {
  return policy?.match(/'nonce-([^']+)'/)?.[1];
}

/**
 * 개발 서버용 이미지 정책. HMR이 eval·websocket을 써서 전체 CSP는 붙일 수 없지만,
 * 외부 이미지 차단은 개발 중에도 똑같이 동작해야 새로 넣은 <img>의 유출 경로를 바로 알아차린다(이슈 #77).
 */
export function buildImageOnlyPolicy(): string {
  return `img-src ${IMAGE_SOURCES.join(" ")}; report-uri ${CSP_REPORT_PATH}`;
}
