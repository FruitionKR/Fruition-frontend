# Frontend 구조

Next.js App Router를 사용하는 독립 npm 프로젝트입니다. `app/`은 페이지·레이아웃을, `src/`는 entities·features·widgets·shared 경계의 화면 구현을 소유합니다. Vercel에 배포합니다.

브라우저는 `/api/*`를 호출하고 `next.config.mjs`의 rewrite가 Access와 Document로 전달합니다. 인증·워크스페이스·멤버·초대는 Access, 그 밖의 업무 요청은 Document가 담당합니다. AI 내부 API는 브라우저에서 직접 호출하지 않습니다.

라우팅 구현은 [next.config.mjs](../next.config.mjs), 경계 회귀 검증은 [gatewayRewrites.test.mjs](../tests/gatewayRewrites.test.mjs)를 참고하세요. 전체 경로와 내부 통신 계약은 platform 및 API 제공 서비스가 관리합니다.

서비스 소스를 형제 폴더에 checkout하지 않아도 frontend의 설치·테스트·빌드가 가능해야 합니다. 실제 업무 동작에는 접근 가능한 Access·Document API가 필요합니다.
