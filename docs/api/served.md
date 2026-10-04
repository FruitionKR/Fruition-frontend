# 제공 API

[API 배선 문서](README.md)

이 저장소가 직접 서비스하는 Next.js route handler다. 실제 서버 엔드포인트이므로
backend 서비스 문서와 **동일한 10개 항목**을 유지한다. 해당 사항이 없더라도 항목을 생략하지 않는다.

- 핸들러 수: 3 (파일 2개)

## API 목차

| API | 목적 |
|---|---|
| [`GET /api/document-transport`](#detail-get-api-document-transport) | 문서 계열 요청을 직접 보낼 backend 오리진과 직접 업로드 가능 여부를 알려준다 |
| [`GET /access/verify`](#detail-get-access-verify) | 현재 브라우저의 접근 코드 게이트 상태를 알려준다 |
| [`POST /access/verify`](#detail-post-access-verify) | 접근 코드를 검증하고 해제 쿠키를 심는다 |

## 한눈에 보기

| API | 입력 | 출력 | 조건 | 주요 오류 |
|---|---|---|---|---|
| `GET /api/document-transport` | 없음 | `200` `{ origin, directUpload }` | 접근 코드 게이트 통과 필요 | `403` 접근 코드 미입력 |
| `GET /access/verify` | 쿠키 `fruition_access` | `200` `{ enabled, unlocked }` | 없음 | 없음 |
| `POST /access/verify` | `{ code }` | `200` `{ ok: true }` + `Set-Cookie` | 없음 | `401` 코드 불일치 |

---

<a id="detail-get-api-document-transport"></a>
## `GET /api/document-transport`

### 1. Method + Path

`GET /api/document-transport`

### 2. 목적

브라우저가 문서 계열 `/api/**` 요청을 rewrite 대신 document-svc 오리진으로 직접 보낼 수 있는지,
그리고 PDF를 S3 multipart로 직접 업로드할 수 있는지를 알려준다. backend 주소를 클라이언트
번들에 넣지 않기 위해 런타임 조회로 처리한다.

### 3. Auth 필요 여부

- 사용자 인증은 불필요하다. Bearer 토큰을 검사하지 않는다.
- 단, `middleware.ts`의 접근 코드 게이트가 `/api/:path*`에 걸려 있고 이 경로는
  `OPEN_API_PATTERNS`에 없다. `ACCESS_CODE`가 설정된 배포에서는 해제 쿠키가 없으면 `403`이다.
- 호출 측(`src/shared/api/documentTransport.ts`)이 본문 없는 이 요청으로 게이트를 먼저 확인한 뒤
  대용량 본문을 보내는 구조다.

### 4. Request body

| 위치 | 이름 | 타입 | 필수 | 설명 |
|---|---|---|---|---|
| - | - | - | - | 요청 파라미터와 본문이 없다 |

### 5. Response body

- HTTP `200`, `Content-Type: application/json`, `Cache-Control: no-store`

| 필드 | 타입 | 설명 |
|---|---|---|
| `origin` | `string \| null` | `BACKEND_URL`의 오리진. 미설정이면 `null`이고 호출 측은 상대 경로를 유지한다 |
| `directUpload` | `boolean` | `origin`이 있고 `DOCUMENT_DIRECT_UPLOAD_ENABLED !== "false"`일 때 `true` |

```json
{ "origin": "https://document.example.com", "directUpload": true }
```

### 6. Error response

| 상태 | 발생 조건 | 본문 |
|---|---|---|
| `403` | 접근 코드 게이트 미해제 (`middleware.ts`가 반환) | `{ "error": { "message": "설정에서 접근 코드를 입력해야 사용할 수 있습니다." } }` |

핸들러 자체는 오류 분기를 갖지 않는다. 호출 측은 `response.ok`가 아니면 본문의
`error.message` 또는 "문서 전송 연결을 확인하지 못했습니다."를 던진다.

### 7. Pagination / filtering

- 해당 없음. 단일 객체를 반환한다.

### 8. 권한 규칙

- 워크스페이스 멤버십이나 역할을 검사하지 않는다. 반환값은 배포 환경 변수에서만 결정되며
  사용자별로 달라지지 않는다.
- 노출되는 값은 backend 오리진 주소와 직접 업로드 플래그뿐이며 사용자 데이터를 담지 않는다.

### 9. 예시 요청/응답

```sh
curl -i http://localhost:3000/api/document-transport \
  -H 'Cookie: fruition_access=<hash>'
```

```
HTTP/1.1 200 OK
Cache-Control: no-store

{"origin":null,"directUpload":false}
```

### 10. 구현 파일

- 핸들러: `app/api/document-transport/route.ts` (`export const dynamic = "force-dynamic"`)
- 호출 측: `src/shared/api/documentTransport.ts` (`getDocumentTransport`, `usesDocumentTransport`)
- 게이트: `middleware.ts`

---

<a id="detail-get-access-verify"></a>
## `GET /access/verify`

### 1. Method + Path

`GET /access/verify`

### 2. 목적

접근 코드 게이트가 이 배포에서 켜져 있는지, 그리고 현재 브라우저가 이미 해제되었는지를 알려준다.
설정 화면이 접근 코드 입력 UI를 보여줄지 결정하는 데 쓴다.

### 3. Auth 필요 여부

- 불필요하다. 사용자 토큰도 접근 코드도 요구하지 않는다.
- `middleware.ts`의 matcher는 `/api/:path*`이므로 이 경로(`/access/verify`)는 게이트를 거치지
  않는다. 게이트 상태를 묻는 엔드포인트 자체가 게이트에 막히면 안 되기 때문이다.

### 4. Request body

| 위치 | 이름 | 타입 | 필수 | 설명 |
|---|---|---|---|---|
| cookie | `fruition_access` | `string` | 아니오 | 해제 쿠키. 없으면 `unlocked: false` |

본문은 없다.

### 5. Response body

- HTTP `200`, `Content-Type: application/json`

| 필드 | 타입 | 설명 |
|---|---|---|
| `enabled` | `boolean` | `ACCESS_CODE` 환경 변수가 설정되어 게이트가 켜져 있는지 |
| `unlocked` | `boolean` | 쿠키 값이 현재 코드의 해시와 일치하는지. `enabled: false`면 항상 `true` |

```json
{ "enabled": true, "unlocked": false }
```

### 6. Error response

| 상태 | 발생 조건 | 본문 |
|---|---|---|
| - | - | 오류 분기가 없다. 쿠키가 없거나 틀려도 `200`과 `unlocked: false`로 응답한다 |

### 7. Pagination / filtering

- 해당 없음.

### 8. 권한 규칙

- 사용자·워크스페이스 권한을 보지 않는다. 쿠키 해시 일치만 판정한다.
- 코드 원문을 응답에 담지 않는다. 쿠키에도 `hashAccessCode` 결과만 저장한다.

### 9. 예시 요청/응답

```sh
curl -s http://localhost:3000/access/verify
# {"enabled":false,"unlocked":true}
```

### 10. 구현 파일

- 핸들러: `app/access/verify/route.ts` (`GET`)
- 헬퍼: `src/shared/lib/accessCode.ts` (`ACCESS_COOKIE`, `getAccessCode`, `hashAccessCode`)

---

<a id="detail-post-access-verify"></a>
## `POST /access/verify`

### 1. Method + Path

`POST /access/verify`

### 2. 목적

사용자가 입력한 접근 코드를 검증하고, 맞으면 `/api/**` 게이트를 통과하는 httpOnly 쿠키를 심는다.

### 3. Auth 필요 여부

- 사용자 인증은 불필요하다. 이 요청 자체가 접근 코드를 제시하는 요청이다.
- `middleware.ts` matcher가 `/api/:path*`이므로 게이트를 거치지 않는다.

### 4. Request body

| 위치 | 이름 | 타입 | 필수 | 설명 |
|---|---|---|---|---|
| body | `code` | `string` | 예 | 접근 코드. 공백은 `trim`한다. 문자열이 아니면 빈 값으로 취급한다 |

- Content-Type: `application/json`

```json
{ "code": "letmein" }
```

### 5. Response body

- HTTP `200`, `Content-Type: application/json`

| 필드 | 타입 | 설명 |
|---|---|---|
| `ok` | `boolean` | 항상 `true` |

성공 시 `Set-Cookie: fruition_access=<hash>`를 함께 보낸다
(`httpOnly`, `sameSite: lax`, `path: /`, 프로덕션에서 `secure`, `maxAge: ACCESS_COOKIE_MAX_AGE`).

`ACCESS_CODE`가 설정되지 않은 배포에서는 검증 없이 `{ "ok": true }`만 반환하고 쿠키를 심지 않는다.

### 6. Error response

| 상태 | 발생 조건 | 본문 |
|---|---|---|
| `401` | 코드가 비었거나 `ACCESS_CODE`와 다름 | `{ "message": "코드가 올바르지 않습니다." }` |

본문 파싱 실패는 `null`로 흡수해 `401`과 같은 경로로 떨어진다. backend의 `ErrorResponse`
envelope 형식(`error.code`)이 아니라 `message` 평면 필드를 쓴다.

### 7. Pagination / filtering

- 해당 없음.

### 8. 권한 규칙

- 워크스페이스·역할 권한과 무관하다. 배포 전체에 하나의 코드를 쓰는 단일 게이트다.
- 코드 비교는 단순 문자열 비교이며 시도 횟수 제한(rate limiting)이 없다.
- 쿠키에는 코드가 아닌 해시를 저장하고 `httpOnly`로 스크립트 접근을 막는다.

### 9. 예시 요청/응답

```sh
curl -i -X POST http://localhost:3000/access/verify \
  -H 'Content-Type: application/json' \
  -d '{"code":"letmein"}'
```

```
HTTP/1.1 200 OK
Set-Cookie: fruition_access=<sha256>; Path=/; HttpOnly; SameSite=Lax

{"ok":true}
```

### 10. 구현 파일

- 핸들러: `app/access/verify/route.ts` (`POST`)
- 헬퍼: `src/shared/lib/accessCode.ts`
- 게이트: `middleware.ts`

---

## middleware

`middleware.ts`는 API가 아니라 `/api/:path*` 전체에 걸리는 전처리다. 10개 항목 대상이 아니므로
동작만 적는다.

- `ACCESS_CODE`가 비어 있으면 게이트를 끄고 전부 통과시킨다.
- 다음 패턴은 코드 없이도 통과한다. 로그인 → 워크스페이스 선택 → 설정 화면까지 도달하는 최소 경로다.
  `/api/auth/`로 시작, `/api/invitations/`로 시작, `/api/workspaces` 정확히 일치,
  `/api/workspaces/{한 segment}` 정확히 일치.
- 그 밖의 `/api/**`는 `fruition_access` 쿠키가 현재 코드의 해시와 같아야 통과한다.
- 불일치 시 `403`과 `{ "error": { "message": "설정에서 접근 코드를 입력해야 사용할 수 있습니다." } }`.

주의: 이 게이트는 `/api/workspaces/{wid}` 하위 경로(문서·Wiki·Agent 등)를 모두 막는다.
`OPEN_API_PATTERNS`의 `/^\/api\/workspaces\/[^/]+$/`는 `$` 앵커 때문에 하위 경로에 매칭되지 않는다.

**이 문서는 middleware를 전수 추적하지 않았다.** 위 내용은 `middleware.ts` 파일 자체를 읽어
확인한 범위이며, Next.js가 middleware·route handler를 경유해 backend로 나가는 추가 경로가
있다면 소비 API 목록에서 누락될 수 있다.

## 개발용 mock 서버

`mock/`은 `npm run mock`(`mock/server.mjs`)과 `npm run dev:mock`(`mock/dev.mjs`)으로만 실행되는
개발 도구다. `src/`·`app/`의 어떤 모듈도 `mock/`을 import하지 않으므로 제공 API도 배선도 아니다.
구성: `mock/routes/`, `mock/lib/`, `mock/pipeline.mjs`, `mock/seed.mjs`, `mock/state.mjs`.
