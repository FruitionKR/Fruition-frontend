# API 배선 문서

이 디렉터리는 frontend가 **어떤 backend API를 어느 모듈에서 호출하는지**, 그리고 **어떤 API를
호출하지 않는지**를 사람 기준으로 설명한다. 기계가 읽는 원본 계약은 각 backend 저장소의
`api-specs/openapi.yaml`이며, 충돌할 경우 backend 명세와 이 저장소의 실행 코드를 우선한다.

## 이 문서의 적응(adaptation)

backend 서비스 문서는 API를 **제공하는** 쪽 기준으로 각 API마다 동일한 10개 항목
(Method+Path / 목적 / Auth / Request body / Response body / Error / Pagination / 권한 규칙 /
예시 / 구현 파일)을 유지한다. 이 저장소는 대부분 API를 **소비하는** 쪽이므로 그 형식을 그대로
쓰면 Request body·권한 규칙·Pagination 같은 항목이 전부 backend 명세의 복제가 되고, 정작
필요한 "누가 이 경로를 부르는가"가 드러나지 않는다. 그래서 두 가지 형식을 나눠 쓴다.

| 대상 | 형식 | 근거 |
|---|---|---|
| 이 저장소가 **제공하는** Next.js route handler | backend와 같은 10개 항목 ([served.md](served.md)) | 실제 서버 엔드포인트이므로 10개 항목이 전부 의미를 가진다 |
| 이 저장소가 **소비하는** backend API | 아래 7개 열의 고정 표 ([consumed/](consumed/README.md)) | 계약 본문은 backend 문서가 소유한다. 여기서 추적할 값은 배선이다 |

소비 API 표는 도메인 문서 전체에서 다음 7개 열을 **같은 순서로 유지**한다. 해당 사항이
없더라도 열을 생략하지 않고 `-`로 둔다.

| 열 | 의미 |
|---|---|
| 메서드 + 경로 | 호출 시점에 실제로 만들어지는 구체 경로. 템플릿 변수는 backend 명세의 이름을 쓴다 |
| 목적 | 이 저장소가 이 호출로 얻으려는 것 |
| 호출 모듈 | 호출이 들어 있는 파일과 export 함수 |
| 경로 생성 | 리터럴인지, `workspacePath(...)`인지, 템플릿 결합인지 |
| 보내는 것 | body·헤더·query 중 이 저장소가 실제로 만드는 것 |
| 쓰는 응답 필드 | 응답에서 이 저장소가 실제로 읽는 필드 |
| 비고 | 멱등 키, 낙관적 잠금, 전용 오류 처리, SSE 등 |

## 집계

| 구분 | 수 |
|---:|---:|
| 제공하는 Next.js route handler | 3개 파일 / 5개 핸들러 |
| 소비하는 document-svc `/api/**` | 87개 중 **54개 호출 / 33개 미호출** |
| 소비하는 access-svc `/api/**` | 29개 중 **26개 호출 / 3개 미호출** |
| `apiFetch` 호출 지점 | 21개 파일 / 85곳 |
| 인증 헤더 없는 raw `fetch` 호출 지점 | 5개 파일 / 11곳 |

`/internal/**` (document-svc 9개, access-svc 3개)는 서비스 간 경로이며 이 저장소는 호출하지 않는다.

## 라우팅 구조

브라우저는 항상 같은 출처의 `/api/**`로 요청하고, `next.config.mjs`의 rewrite가 두 backend로 나눈다.

- access-svc(`ACCESS_URL`, 기본 `http://localhost:8081`) — `/api/auth/*`, `/api/invitations/*`,
  `/api/workspaces`, `/api/workspaces/{wid}`, `/api/workspaces/{wid}/restore`,
  `/api/workspaces/{wid}/icon/*`, `/api/workspaces/{wid}/members*`, `/api/workspaces/{wid}/invitations*`
- document-svc(`BACKEND_URL`, 기본 `http://localhost:8080`) — 그 밖의 모든 `/api/:path*`

rewrite는 배열 순서대로 먼저 매칭되는 규칙이 적용된다. 즉 워크스페이스 자체 CRUD와 멤버십은
access-svc, 그 밖의 워크스페이스 하위 기능은 document-svc가 받는다.

`BACKEND_URL`이 설정되면 `NEXT_PUBLIC_DOCUMENT_DIRECT_API=true`가 되고, 문서 계열 경로는
rewrite를 우회해 document-svc 오리진으로 직접 전송된다. 판정 규칙은 [client.md](client.md)를 본다.

## 문서 읽는 법

1. 공통 전송 계층(토큰 재발급, 경로 생성, 멱등 키, 오류 메시지)을 알아야 하면 [client.md](client.md).
2. 이 저장소가 직접 서비스하는 엔드포인트는 [served.md](served.md).
3. 특정 기능이 어떤 backend API를 쓰는지는 [consumed/](consumed/README.md)에서 도메인을 고른다.
4. 특정 backend API가 왜 안 쓰이는지는 [uncalled.md](uncalled.md).

## 목차

| 문서 | 내용 |
|---|---|
| [client.md](client.md) | `src/shared/api` 전송 계층 계약 |
| [served.md](served.md) | 이 저장소가 제공하는 route handler와 middleware |
| [consumed/README.md](consumed/README.md) | 소비 API 도메인 목차 |
| [uncalled.md](uncalled.md) | 미호출 backend API와 의도적 비사용·실제 공백 분류 |

## 이 문서의 한계

- 조사 기준은 `origin/main`(`0b03db1`)이다. 다른 작업 분기에서 진행 중인 배선은 반영하지 않는다.
- Next.js route handler와 `middleware.ts`는 **전수 추적하지 않았다**. 두 route handler 파일과
  middleware 파일 자체는 읽었지만, 서버 측에서 route handler를 경유해 backend로 나가는 경로를
  전부 쫓지는 않았다. 그런 경로가 있다면 이 문서의 소비 목록에서 빠질 수 있다.
- `mock/`은 `npm run mock` / `npm run dev:mock` 전용 개발 도구다. `src/`·`app/`의 어떤 모듈도
  `mock/`을 import하지 않으므로 배선이 아니라 개발 도구로만 기록한다.
- 어떤 backend API가 존재한다는 사실만으로 대응 UI가 있다고 기술하지 않았다. UI 유무는
  호출 모듈을 실제로 확인한 범위에서만 적는다.
