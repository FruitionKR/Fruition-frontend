/** @type {import('next').NextConfig} */
// 백엔드 분리: 인증·워크스페이스 CRUD는 access-svc(8081), 나머지 기능 경로는 document-svc(8080).
const accessUrl = process.env.ACCESS_URL || "http://localhost:8081";
const documentUrl = process.env.BACKEND_URL || "http://localhost:8080";
// AWS 배포는 ALB가 화면·API를 같은 호스트에서 경로로 나눈다. Next가 API를 중계하면 access-svc가
// 보는 클라이언트 IP가 프론트 서버 주소가 되므로, 이 모드에서는 rewrite·redirect를 두지 않는다.
const sameOriginApi = process.env.SAME_ORIGIN_API === "true";

const nextConfig = {
  output: sameOriginApi ? "standalone" : undefined,
  env: { NEXT_PUBLIC_DOCUMENT_DIRECT_API: process.env.BACKEND_URL || sameOriginApi ? "true" : "false" },
  async redirects() {
    if (sameOriginApi) return [];
    // OAuth 시작은 access-svc 오리진으로 직접 이동해야 한다(redirect_uri가 서버 자신 오리진 기준).
    // 서버 리다이렉트로 처리해 백엔드 주소를 브라우저 번들에 넣지 않는다.
    return [
      {
        source: "/oauth2/authorization/:provider",
        destination: `${accessUrl}/oauth2/authorization/:provider`,
        permanent: false
      }
    ];
  },
  async rewrites() {
    if (sameOriginApi) return [];
    // 배열 순서대로 먼저 매칭되는 규칙이 적용된다.
    return [
      {
        source: "/api/auth/:path*",
        destination: `${accessUrl}/api/auth/:path*`
      },
      {
        source: "/api/workspaces",
        destination: `${accessUrl}/api/workspaces`
      },
      {
        // 워크스페이스 자체 CRUD·휴지통·복구는 access-svc. 그 밖의 하위 기능은 document-svc가 받는다.
        source: "/api/workspaces/:wid",
        destination: `${accessUrl}/api/workspaces/:wid`
      },
      {
        source: "/api/workspaces/:wid/restore",
        destination: `${accessUrl}/api/workspaces/:wid/restore`
      },
      {
        source: "/api/workspaces/:wid/icon/:path*",
        destination: `${accessUrl}/api/workspaces/:wid/icon/:path*`
      },
      {
        // 멤버 관리와 초대는 멤버십을 소유한 access-svc가 받는다.
        source: "/api/workspaces/:wid/members",
        destination: `${accessUrl}/api/workspaces/:wid/members`
      },
      {
        source: "/api/workspaces/:wid/members/:uid",
        destination: `${accessUrl}/api/workspaces/:wid/members/:uid`
      },
      {
        source: "/api/workspaces/:wid/invitations",
        destination: `${accessUrl}/api/workspaces/:wid/invitations`
      },
      {
        source: "/api/workspaces/:wid/invitations/:invitationId",
        destination: `${accessUrl}/api/workspaces/:wid/invitations/:invitationId`
      },
      {
        // 초대 링크 수신자가 부르는 경로. 워크스페이스 하위가 아니라 최상위다.
        source: "/api/invitations/:path*",
        destination: `${accessUrl}/api/invitations/:path*`
      },
      {
        source: "/api/:path*",
        destination: `${documentUrl}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
