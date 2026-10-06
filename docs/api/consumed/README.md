# 소비 API

[API 배선 문서](../README.md)

이 저장소가 호출하는 backend API를 코드 구성(`src/entities`, `src/features`, `src/widgets`)에
맞춰 도메인별로 나눴다. 모든 표는 [루트 README](../README.md#이-문서의-적응adaptation)에 정의한
7개 열을 같은 순서로 유지한다.

## 도메인 목차

| 도메인 | 호출 수 | 서비스 | 주 모듈 |
|---|---:|---|---|
| [인증·계정](auth-account.md) | 21 | access-svc | `src/entities/user/api` |
| [워크스페이스](workspace.md) | 12 | access-svc | `src/entities/workspace/api` |
| [문서·트리](document.md) | 25 | document-svc | `src/entities/document/api`, `src/entities/tree/api`, `src/features/note-editing`, `src/features/document-history` |
| [Wiki](wiki.md) | 7 | document-svc | `src/entities/wiki/api`, `src/features/wiki-export`, `src/features/document-notifications` |
| [AI·Agent·Query](ai-agent.md) | 18 | document-svc | `src/entities/ai/api`, `src/entities/chat/api`, `src/entities/operation-log/api`, `src/features/agent-chat/api` |
| [Skill](skill.md) | 7 | document-svc | `src/entities/skill/api` |

"호출 수"는 코드상의 호출 지점 수이고, 아래 집계의 "경로 수"는 서로 다른 backend 경로 수다.
같은 경로를 여러 모듈에서 부르기 때문에 두 수는 다르다.

## 경로 집계

| 서비스 | `/api/**` 전체 | 호출 | 미호출 |
|---|---:|---:|---:|
| document-svc | 87 | 54 | 33 |
| access-svc | 29 | 26 | 3 |

미호출 경로는 [uncalled.md](../uncalled.md)에서 의도적 비사용과 실제 공백으로 나눠 다룬다.

## 경로 미해석

없다. 85개 `apiFetch` 호출 지점과 11개 raw `fetch` 호출 지점 전부를 구체 경로까지 해석했다.
다음 세 곳은 변수를 호출자까지 따라가야 해석되므로 근거를 남긴다.

| 호출 지점 | 변수 | 호출자 추적 결과 |
|---|---|---|
| `src/entities/document/api/multipartUpload.ts` `uploadPdfMultipart(endpoint, ...)` | `endpoint` | 유일한 호출자가 `src/entities/document/api/document.ts:64`의 `uploadDocumentFile`이고 `workspacePath(workspaceId, "documents", "uploads")`를 넘긴다. 따라서 `endpoint` = `/api/workspaces/{workspace_id}/documents/uploads`, 파생 경로는 `/parts`·`/complete`·`/abort` |
| `src/entities/tree/api/folders.ts` `mutateTreeItem(id, type, method, suffix, ...)` | `type`, `suffix` | 네 개 래퍼가 전부 같은 파일 안에 있다. `renameFolder`→`folders/{id}`, `deleteFolder`→`folders/{id}`, `moveFolder`→`folders/{id}/position`, `moveDocument`→`documents/{id}/position` |
| `src/shared/api/assets.ts` `acquireAssetObjectUrl(path)` | `path` | 문서 본문에서 `MANAGED_ASSET_PATH_IN_TEXT` 정규식으로 추출한 값이며 형태가 `/api/workspaces/{workspace_id}/assets/{asset_id}/content`로 고정된다 |

리터럴 검색만으로는 `documents/uploads/parts`·`complete`·`abort`,
`folders/{id}/position`, `documents/{id}/position`, `agent/turn/{run_id}/events`,
`ai/tasks/{id}/cancel`, `documents/{id}/versions`·`diff`·`versions/{v}/restore`,
`query/runs/{id}`·`events`가 모두 누락된다. 이 문서는 그 경로들을 명시적으로 포함한다.
