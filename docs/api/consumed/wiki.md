# Wiki 소비 API

[API 배선 문서](../README.md) / [소비 API](README.md)

document-svc의 Wiki 조회·내보내기·유지보수 API다. `wiki/**`는 직접 전송 정규식에 **없어서**
rewrite를 경유하고, `chat/**`은 정규식에 있어 직접 전송 대상이다.

- 호출 지점: 7
- 호출 경로: 6

## 조회

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/wiki/graph` | Wiki 페이지 그래프 | `src/entities/wiki/api/wiki.ts` `fetchWikiGraph` | `workspacePath(getWorkspaceId(), "wiki", "graph")` | `cache: no-store` | `WikiGraphResponse` 전체 | 그래프 위젯(`src/widgets/graph`)의 데이터 원천 |
| `GET /api/workspaces/{workspace_id}/wiki/pages/{wiki_page_id}` | Wiki 페이지 상세 | `src/entities/wiki/api/wiki.ts` `fetchWikiPage` | `workspacePath(workspaceId, "wiki", "pages", pageId)` | `cache: no-store` | `WikiPageDetailResponse` 전체 | 그래프 노드 선택 시 본문을 채운다 |

`fetchDocumentData`(`src/entities/wiki/api/wiki.ts`)는 Wiki 전용 경로가 아니라
`documents`와 `document-tree`를 `Promise.all`로 병렬 호출한다. 두 경로는
[document.md](document.md)에 기록했다.

## 채팅 → Wiki 내보내기

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/chat/sessions/{session_id}/wiki` | 채팅 내용을 원문 문서로 저장 | `src/features/wiki-export/api/export.ts` `exportChatWiki` | `workspacePath(workspaceId, "chat", "sessions", sessionId, "wiki")` | `{ selection_mode, pair_ids }`. `pairIds`가 비면 `full`+`[]`, 있으면 `partial`+선택 ID | `exportDocumentId`, `status` | 세션 ID는 `getSessionContext()`(`src/entities/chat/api/chat.ts`)가 캐시·조회·생성 순으로 확보한다. 저장만 하고 ingest는 별도 요청이다 |

내보낸 문서의 Wiki 편입은 문서 계열 경로
(`documents/{document_id}/ingest` 또는 `convert-markdown`)로 이어진다. [document.md](document.md) 참조.

## 유지보수(Lint)

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/wiki/maintenance/status` | Lint 필요 여부 확인 | `src/features/document-notifications/api/wikiLint.ts` `fetchWikiMaintenanceStatus` | `workspacePath(getWorkspaceId(), "wiki", "maintenance", "status")` | `cache: no-store` | `needs_lint`, `last_lint_at`, `last_wiki_change_at` | 알림 배지의 근거 |
| `POST /api/workspaces/{workspace_id}/wiki/maintenance/lint` | Lint 실행 또는 dry-run | `src/features/document-notifications/api/wikiLint.ts` `requestWikiLint` | `workspacePath(getWorkspaceId(), "wiki", "maintenance", "lint")` | `{ dry_run }` | `run_id` | backend는 `dry_run: false`를 명시하지 않으면 dry-run으로 처리한다. 이 저장소는 항상 명시한다 |
| `GET /api/workspaces/{workspace_id}/wiki/maintenance/runs/{run_id}` | Lint run 상태 폴링 | `src/features/document-notifications/api/wikiLint.ts` `requestWikiLint` 내부 | `workspacePath(getWorkspaceId(), "wiki", "maintenance", "runs", queued.run_id)` | `cache: no-store` | `status`, `error`, `manifest.task_result.changed_pages` | SSE가 아닌 **폴링**(`pollUntil`, `src/shared/lib/polling.ts`). run 레코드 생성 지연을 고려해 `404`를 "계속 폴링"으로 해석한다. `succeeded`면 `changed_pages.length`를 센다 |

## UI 위치

- 그래프 뷰: `src/widgets/graph/ui`, `src/widgets/graph/model`
- Wiki 편입 상태·확인: `src/features/wiki-ingest/ui`, `src/features/wiki-ingest/model`
- Lint 알림: `src/features/document-notifications/ui`

## 호출하지 않는 Wiki 경로

`wiki/pages/{wiki_page_id}/diff`, `wiki/pages/{wiki_page_id}/rename`,
`chat/sessions/{session_id}/wiki/preview`, 그리고 `wiki-schema/**` 4개. [uncalled.md](../uncalled.md) 참조.
