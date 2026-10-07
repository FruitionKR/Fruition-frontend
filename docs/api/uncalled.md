# 미호출 backend API

[API 배선 문서](README.md)

이 저장소가 `origin/main`(`0b03db1`) 기준으로 호출하지 않는 backend `/api/**` 경로다.
"미호출"은 결함이 아니다. 아래 네 가지로 분류한다.

| 분류 | 의미 |
|---|---|
| 의도적 비사용 | 더 적합한 다른 API를 쓰거나, 클라이언트에서 처리하거나, 기능 범위 밖이다 |
| 진행 중 | 다른 작업 분기에서 배선 중이다. `origin/main`에는 없다 |
| UI 없음 | 대응 UI 자체가 이 저장소에 없다 |
| 미배선 | UI 또는 필요가 있는데 호출이 없다. 실제 공백 후보 |

## 집계

| 서비스 | 전체 `/api/**` | 호출 | 미호출 |
|---|---:|---:|---:|
| document-svc | 87 | 54 | 33 |
| access-svc | 29 | 26 | 3 |

미호출 33개 분류: 의도적 비사용 4, 진행 중 6, UI 없음 9, 미배선 14.

---

## document-svc 미호출 33개

### 의도적 비사용

| 경로 | 근거 |
|---|---|
| `POST /api/workspaces/{workspace_id}/chat/sessions/{session_id}/query` | 동기 Query. 이 저장소는 비동기 `query/runs` + SSE `GET /api/query/runs/{request_id}/events` 조합을 쓴다(`src/entities/wiki/api/wiki.ts` `runQueryStream`, 함수 주석에 흐름이 명시되어 있다). 질의 중 단계 표시와 취소(`ai/tasks/{id}/cancel`)가 필요해 선택한 설계이며 **공백이 아니다** |
| `GET /api/workspaces/{workspace_id}/navigation` | 트리는 `document-tree`를 한 번 받아 쓴다 |
| `GET /api/workspaces/{workspace_id}/navigation/search` | `src/features/document-search/model/useDocumentSearch.ts`가 이미 받아 둔 트리를 `allItems.filter(...)`로 **클라이언트에서 필터링**한다. 서버 검색을 부르지 않는 것이 현재 설계다 |
| `GET /api/workspaces/{workspace_id}/navigation/breadcrumb` | 경로 표시도 받아 둔 트리에서 계산한다(`src/entities/tree/model/serverTree.ts` `findServerParent` 등) |

`navigation*` 3개를 "의도적"으로 분류한 근거는 대체 구현이 코드에 실제로 있다는 점이다.
다만 트리 전체를 받아 클라이언트에서 거르는 방식이므로 워크스페이스 규모가 커지면
재검토 대상이 될 수 있다. 그 판단은 이 문서의 범위를 넘는다.

### 진행 중 (다른 분기에서 배선 중)

`origin/main`에는 호출이 없다. **아직 반영되지 않은 작업**이므로 완료로 읽지 말 것.

| 경로 | 상태 |
|---|---|
| `GET /api/workspaces/{workspace_id}/wiki-schema/active` | wiki-schema 배선 진행 중. 현재는 `src/entities/schema/api/schema.ts`의 `localStorage` 목업 |
| `POST /api/workspaces/{workspace_id}/wiki-schema/drafts` | 같음 |
| `POST /api/workspaces/{workspace_id}/wiki-schema/preview` | 같음 |
| `POST /api/workspaces/{workspace_id}/wiki-schema/{schema_id}/activate` | 같음 |
| `POST·DELETE /api/workspaces/{workspace_id}/documents/{document_id}/edit-lock` | 호출 없음. `main` 기준으로는 배선 여부를 확인할 수 없다 |
| `POST /api/workspaces/{workspace_id}/documents/{document_id}/edit-lock/heartbeat` | 같음 |

### UI 없음 — 음성·회의

이 저장소에 음성·회의 UI가 **전혀 없다.** `MediaRecorder`, `getUserMedia`, `WebSocket`
어느 것도 `src/`·`app/`에 나타나지 않는다. 따라서 아래 9개 경로는 대응 화면 자체가 없다.
이 문서는 그 사실만 기록하고 내용은 다루지 않는다.

| 경로 |
|---|
| `/api/workspaces/{workspace_id}/meetings` |
| `/api/workspaces/{workspace_id}/meetings/{meeting_id}` |
| `/api/workspaces/{workspace_id}/meetings/{meeting_id}/live-tickets` |
| `/api/workspaces/{workspace_id}/meetings/{meeting_id}/notes` |
| `/api/workspaces/{workspace_id}/meetings/{meeting_id}/notes/{version}/append-preview` |
| `/api/workspaces/{workspace_id}/meetings/{meeting_id}/notes/{version}/apply` |
| `/api/workspaces/{workspace_id}/meetings/{meeting_id}/recording` |
| `/api/workspaces/{workspace_id}/meetings/{meeting_id}/recording-url` |
| `/api/workspaces/{workspace_id}/speech/transcriptions` |

### 미배선 (실제 공백 후보)

호출 지점이 전혀 없는 경로다. 각 항목의 "확인한 것"은 코드에서 직접 확인한 사실만 적었다.
UI 필요 여부를 단정하지 않는다.

| 경로 | 확인한 것 |
|---|---|
| `POST /api/workspaces/{workspace_id}/agent/runs/{run_id}/cancel` | `decideAgentPlan`의 `decision` 타입이 `"approve" \| "reject"`로만 선언되어 이 segment가 만들어질 수 없다 |
| `POST /api/workspaces/{workspace_id}/agent/runs/{run_id}/revise` | 같은 이유 |
| `POST /api/workspaces/{workspace_id}/chat/sessions/{session_id}/wiki/preview` | 내보내기는 미리보기 없이 `.../wiki`를 바로 호출한다(`src/features/wiki-export/api/export.ts`) |
| `GET /api/workspaces/{workspace_id}/documents/trash` | 휴지통 조회 호출이 없다. `src/`에 `trash` 문자열 자체가 없다 |
| `POST /api/workspaces/{workspace_id}/documents/{document_id}/restore` | 문서 복구 호출이 없다. 삭제는 소프트 삭제인데 복구 경로가 배선되지 않았다 |
| `POST /api/workspaces/{workspace_id}/folders/{folder_id}/restore` | 폴더 복구 호출이 없다 |
| `GET /api/workspaces/{workspace_id}/documents/markdown` | Markdown 문서 전용 목록. 이 저장소는 `documents` 전체 목록만 쓴다 |
| `POST /api/workspaces/{workspace_id}/documents/{document_id}/duplicate` | 복제 호출이 없다 |
| `GET /api/workspaces/{workspace_id}/documents/{document_id}/export` | 문서 내보내기 호출이 없다 |
| `GET /api/workspaces/{workspace_id}/folders/{folder_id}/children` | 자식 조회를 쓰지 않는다. 트리를 한 번에 받는다 |
| `GET /api/workspaces/{workspace_id}/usage/models` | 모델 사용량 조회 호출이 없다. 설정 화면은 `ai-models`와 `ai-model-settings`만 쓴다 |
| `GET /api/workspaces/{workspace_id}/wiki/pages/{wiki_page_id}/diff` | Wiki 페이지 변경 비교 호출이 없다 |
| `PATCH /api/workspaces/{workspace_id}/wiki/pages/{wiki_page_id}/rename` | Wiki 페이지 이름 변경 호출이 없다 |

---

## access-svc 미호출 3개

| 경로 | 분류 | 확인한 것 |
|---|---|---|
| `GET /api/workspaces/trash` | 미배선 | 워크스페이스 휴지통 조회 호출이 없다 |
| `POST /api/workspaces/{workspace_id}/restore` | 미배선 | 워크스페이스 복구 호출이 없다. `next.config.mjs`에는 이 경로를 access-svc로 보내는 rewrite 규칙이 **있다** |
| `DELETE /api/workspaces/{workspace_id}/invitations/{invitation_id}` | 미배선 | 초대 발송(`POST .../invitations`)은 있는데 취소 호출이 없다 |

access-svc에는 워크스페이스 삭제(`DELETE /api/workspaces/{workspace_id}`)도 있다.
이 저장소는 같은 경로에 `PATCH`(이름 변경)만 보낸다. 경로 단위 집계에서는 호출로 세었으므로
메서드 단위로는 `DELETE`가 미배선이다. 이 문서의 집계는 **경로 단위**다.

---

## 집계 방법과 이견

- 집계 단위는 **OpenAPI path 항목**이며 메서드 단위가 아니다. 같은 경로에 GET과 DELETE가
  있고 하나만 부르면 "호출"로 센다. 위 access-svc 주석이 그 예다.
- document-svc 경로 수는 `origin/main`의 `api-specs/openapi.yaml`에서 세었다.
  전체 96개 = `/api/**` 87 + `/internal/**` 9. 이 저장소는 `/internal/**`을 호출하지 않는다.
- 호출 판정은 리터럴 grep이 아니라 각 `apiFetch`·`fetch` 호출 지점의 경로 표현식을
  변수의 호출자까지 따라가 구체 경로로 해석한 결과다. 근거는
  [consumed/README.md](consumed/README.md#경로-미해석)에 정리했다.
- 사전에 **52 호출 / 35 미호출**로 측정된 수치가 있었다. 이 문서의 독립 집계는
  **53 / 34**이고 1개 차이가 난다. 차이의 후보는 리터럴 검색으로 잡히지 않는
  템플릿 결합 경로들이다. 특히 다음 경로들은 호출로 확정했으나 누락되기 쉽다.
  - `POST .../agent/runs/{run_id}/approve` 및 `/reject` — 경로 마지막 segment가
    변수 `decision`이다(`workspacePath(workspaceId, "agent", "runs", runId, decision)`).
  - `PATCH .../documents/{document_id}/position` 및 `.../folders/{folder_id}/position` —
    `mutateTreeItem`의 `...suffix` 전개로 만들어진다.
  - `POST .../documents/uploads/parts`·`/complete`·`/abort` — 호출자가 넘긴
    `endpoint` 변수에 접미사를 붙인다.
  - `GET .../documents/{document_id}/versions`·`/diff`, `POST .../versions/{version}/restore` —
    로컬 `documentPath()`가 `workspacePath`를 감싼 이중 조립이다.
  - `POST .../ai/tasks/{id}/cancel` — `workspacePath` 결과에 `/cancel`을 붙인다.
  - `GET .../agent/turn/{run_id}/events` — 같은 패턴.
  53/34가 맞다고 보지만, 두 집계가 각각 어느 경로를 다르게 분류했는지는 위 목록을
  하나씩 맞춰 보면 확인할 수 있다.

## 재확인이 필요한 한계

- Next.js route handler와 `middleware.ts`를 **전수 추적하지 않았다.** 서버 측에서 route
  handler를 경유해 backend로 나가는 경로가 있다면 이 저장소가 실제로는 호출하는데
  "미호출"로 분류될 수 있다. 현재 확인된 route handler 2개
  (`app/api/document-transport/route.ts`, `app/access/verify/route.ts`)는 모두 환경 변수와
  쿠키만 보고 backend를 호출하지 않는다.
- `mock/`에 라우트가 존재한다는 사실은 프로덕션 배선의 근거가 아니다. `src/`·`app/`의 어떤
  모듈도 `mock/`을 import하지 않는다.
