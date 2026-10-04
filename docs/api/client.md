# 전송 계층 계약

[API 배선 문서](README.md)

소비 API 표의 "경로 생성"·"비고" 열이 가리키는 공통 규칙을 한곳에 모았다. 구현은
`src/shared/api/client.ts`, `src/shared/api/documentTransport.ts`, `src/shared/api/assets.ts`다.

## apiFetch

`apiFetch(path, init)` — `src/shared/api/client.ts`

1. `usesDocumentTransport(path)`가 참이고 브라우저 환경이면 `getDocumentTransport()`로 받은
   오리진을 경로 앞에 붙이고 `credentials: "omit"`으로 바꾼다.
2. `getAccessToken()`이 있으면 `Authorization: Bearer <access token>`을 붙인다.
3. 응답이 `401`이 아니면 그대로 반환한다.
4. `401`이면 자격 증명 거절(아래)인지 먼저 확인하고, 아니면 refresh 후 1회 재시도한다.
5. 재발급까지 실패하면 `ERROR_MESSAGES.loginRequired`("로그인이 필요합니다.")를 던진다.

재발급 대상 판정: `path === "/api/auth/me"` 또는 `/api/auth/me/`로 시작하거나,
`/api/auth/`로 시작하지 **않는** 경로. 즉 로그인·회원가입 요청 자체의 `401`은 재발급하지 않는다.

자격 증명 거절 예외 — 다음 경로의 `401`은 토큰 만료가 아니라 입력값 불일치로 보고 재시도하지 않는다.

| 경로 | 기대 오류 코드 |
|---|---|
| `/api/auth/me/password` | `INVALID_CREDENTIALS` |
| `/api/auth/me/mfa` | `INVALID_MFA_CODE` |
| `/api/auth/me/mfa/activate` | `INVALID_MFA_CODE` |

## 토큰 재발급

`apiFetch` 내부에서 `POST /api/auth/refresh`를 **raw `fetch`로** 호출한다(Bearer 없음, 쿠키 기반).
동시 `401`이 중복 재발급하지 않도록 진행 중인 promise를 공유하고, `withAuthRefreshLock`으로
탭 간 중복도 막는다. 응답의 `access_token`을 `saveAccessToken`으로 저장한다.

이 호출은 소비 API 표에서 [auth-account.md](consumed/auth-account.md)에 기록한다.

## 경로 생성

`workspacePath(workspaceId, ...segments)` — 모든 segment를 `encodeURIComponent`로 감싸
`/api/workspaces/{encoded id}/{encoded...}`를 만든다.

소비 API 표의 "경로 생성" 열은 다음 세 가지로 적는다.

- `리터럴` — `"/api/ai-models"`처럼 코드에 문자열로 그대로 있다.
- `workspacePath(...)` — 헬퍼로 조립한다. 괄호 안에 실제 인자를 적는다.
- `템플릿 결합` — `workspacePath(...)` 결과나 호출자가 넘긴 변수에 접미사를 붙인다.
  (`` `${path}/cancel` ``, `` `${endpoint}/parts` ``, `documentPath(id) + "/versions"` 등)

템플릿 결합 경로는 리터럴 검색으로는 찾히지 않는다. 이 문서는 변수를 호출자까지 따라가
구체 경로를 적어 두었다.

`getWorkspaceId()`는 워크스페이스 선택 화면이 저장한 id를 꺼내고, 없으면
`ERROR_MESSAGES.workspaceRequired`를 던진다.

## 직접 전송 경로

`usesDocumentTransport(path)` — `src/shared/api/documentTransport.ts`

```
/^\/api\/workspaces\/[^/]+\/(?:documents|document-tree|folders|agent|chat|wiki-schema|skills)(?:\/|$)/
```

이 정규식에 맞는 경로만 `GET /api/document-transport`(이 저장소가 제공, [served.md](served.md))가
돌려준 오리진으로 직접 보낸다. 인증·refresh는 항상 동일 출처 경로를 쓴다.
오리진 검증: https 또는 로컬 http만 허용하고, 사용자 정보가 붙은 URL과 경로가 섞인 URL을 거절한다.

`NEXT_PUBLIC_DOCUMENT_DIRECT_API !== "true"`거나 서버 렌더링 중이면 상대 경로를 유지한다.

주의: 이 정규식은 `assets`·`wiki`·`ai-operation-logs`·`ai-model-settings`를 포함하지 않는다.
즉 같은 document-svc API라도 관리 이미지와 Wiki 조회는 rewrite 경유로 남는다.

## 멱등 요청

- `idempotencyKey()` — `crypto.randomUUID()`
- `idempotentJsonHeaders()` — `Content-Type: application/json` + `Idempotency-Key`

소비 API 표의 "비고" 열에 `Idempotency-Key`로 표기한 호출이 이 헤더를 보낸다.
multipart 업로드 등록은 재시도에서도 **같은 키**를 재사용해 중복 문서 생성을 막는다.

## 낙관적 잠금

문서·폴더 변경 계약은 `base_version`을 요구한다. 이 저장소는 보내기 직전에 현재 버전을 얻고
불일치(`409`)는 호출자에게 전용 오류로 올린다.

| 얻는 방법 | 쓰는 곳 |
|---|---|
| `GET .../documents/{document_id}` 의 `current_version` | 문서 삭제·이름 변경 |
| `GET .../document-tree` 항목의 `current_version` | 폴더·문서 이동·이름 변경·폴더 삭제 |
| 편집기 상태의 `content_version` | 본문 저장, 버전 복원 |

`409`를 전용 오류 타입으로 바꾸는 지점: `NoteContentConflictError`
(`src/features/note-editing/api/note.ts`), `VersionRestoreConflictError`
(`src/features/document-history/api/versions.ts`),
`DocumentNameConflictError`(`src/entities/document/api/document.ts`, 서버 호출 전 클라이언트 선점 검사).

## 오류 처리

- `parseErrorResponse(response, fallback)` — `error.message` → `detail`(문자열 또는 `detail.message`)
  → fallback 순서로 메시지를 뽑는다. access-svc·document-svc의 `ErrorResponse` envelope와
  FastAPI 형식을 모두 받아들인다.
- `throwIfNotOk(response, fallback)` — 본문이 필요 없는 요청.
- `parseJsonOrThrow<T>(response, fallback)` — JSON 본문이 필요한 요청.
- `ERROR_MESSAGES` — 사용자에게 보이는 한국어 기본 메시지 상수(27개).

HTTP 상태 코드별 분기는 backend 명세가 소유하고, 이 저장소는 위 세 헬퍼로 묶어 처리한다.
예외적으로 상태 코드를 직접 보는 지점은 `404`(노트 draft 없음 → `null`),
`409`(낙관적 잠금 충돌), `>= 500`(multipart 등록 재시도)뿐이다.

## 관리 이미지

`src/shared/api/assets.ts`는 `/api/workspaces/{workspace_id}/assets/{asset_id}/content` 형태의
경로만 `apiFetch`로 받아 object URL로 바꾼다. 일반 `<img src>`는 Bearer를 붙일 수 없어 `401`이
되기 때문이다. 경로는 backend가 본문 저장 응답에서 치환해 돌려주는 값이며, 이 저장소는
`MANAGED_ASSET_PATH` 정규식으로 판정만 한다. acquire/release 참조 계수로 object URL을 revoke한다.

## SSE

Authorization 헤더가 필요해 `EventSource`를 쓸 수 없다. `Accept: text/event-stream`을 붙인
`apiFetch`로 응답 본문 스트림을 직접 읽고, 공통 파서 `readRunEvents`
(`src/shared/lib/runEvents.ts`)가 단계 이벤트와 종료 상태를 해석한다. 종료 후에는 상태 조회
API를 한 번 더 불러 최종 결과를 확정한다. 이 패턴을 쓰는 호출은 두 곳이다
([ai-agent.md](consumed/ai-agent.md)).
