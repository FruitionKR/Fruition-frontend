# Wiki 소비 API

[API 배선 문서](../README.md) / [소비 API](README.md)

document-svc의 Wiki 조회·내보내기·유지보수 API다. `wiki/**`는 직접 전송 정규식에 **없어서**
rewrite를 경유하고, `chat/**`은 정규식에 있어 직접 전송 대상이다.

- 호출 지점: 8
- 호출 경로: 7

## 조회

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/wiki/graph` | Wiki 페이지 그래프 | `web/src/entities/wiki/api/wiki.ts` `fetchWikiGraph` | `workspacePath(getWorkspaceId(), "wiki", "graph")` | `cache: no-store`, 마지막 응답의 `ETag`가 있으면 `If-None-Match` | `WikiGraphResponse` 전체, `ETag` 헤더 | 그래프 위젯(`web/src/widgets/graph`)의 데이터 원천. `304`면 같은 워크스페이스에서 마지막으로 받은 그래프를 그대로 돌려준다(document #131). 캐시는 모듈 변수 하나이며 워크스페이스가 다르면 조건 없이 받는다 |
| `GET /api/workspaces/{workspace_id}/wiki/pages/{wiki_page_id}` | Wiki 페이지 상세 | `web/src/entities/wiki/api/wiki.ts` `fetchWikiPage` | `workspacePath(workspaceId, "wiki", "pages", pageId)` | `cache: no-store` | `WikiPageDetailResponse` 전체. `revision`은 본문 저장의 `base_revision`(키가 없으면 0) | 그래프 노드 선택 시 본문을 채운다. 저장 409 뒤 최신 본문 비교에도 쓴다 |

## 본문 편집

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `PUT /api/workspaces/{workspace_id}/wiki/pages/{wiki_page_id}/content` | 사람이 고친 본문 저장(document #130) | `web/src/entities/wiki/api/wiki.ts` `saveWikiPageContent` | `workspacePath(getWorkspaceId(), "wiki", "pages", pageId, "content")` | `{ markdown, base_revision, revision_write_id }` | `markdown`, `revision`, `updated_at` | 편집을 열 때 `revision`과 UUID write ID를 잡는다. 실패 뒤 같은 본문을 다시 저장하면 같은 write ID를 쓰고(503 재시도), 본문을 더 고쳤으면 새로 만든다(`web/src/features/wiki-page-editing/model/wikiPageEdit.ts` `prepareWikiPageSave`). `409 WIKI_PAGE_VERSION_CONFLICT`(`error.current_revision`)·`409 IDEMPOTENCY_CONFLICT`는 내 편집을 편집기에 둔 채 최신 본문을 다시 받아 보여 주고, 최신 revision 위에 새 write ID로 저장하거나 내 편집을 버릴 수 있다. `403 WORKSPACE_PERMISSION_REQUIRED`·`402`는 공통 `getErrorMessage` 문구, `503 WIKI_PAGE_PIPELINE_UNAVAILABLE`·`413`·`404`는 편집 화면 문구. 저장 뒤 `refreshBackendData`로 그래프를 다시 받는다. 편집 버튼은 OWNER이거나 멤버 응답의 `permissions`에 `wiki.ingest`가 있을 때만 활성이다 |

`fetchDocumentData`(`web/src/entities/wiki/api/wiki.ts`)는 Wiki 전용 경로가 아니라
`documents`와 `document-tree`를 `Promise.all`로 병렬 호출한다. 두 경로는
[document.md](document.md)에 기록했다.

## 채팅 → Wiki 내보내기

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/chat/sessions/{session_id}/wiki` | 채팅 내용을 원문 문서로 저장 | `web/src/features/wiki-export/api/export.ts` `exportChatWiki` | `workspacePath(workspaceId, "chat", "sessions", sessionId, "wiki")` | `{ pair_ids }`. 비어 있으면 400이라 세션 전체도 모든 pair id를 담아 보낸다 | `exportDocumentId`, `status` | 세션 ID는 `getSessionContext()`(`web/src/entities/chat/api/chat.ts`)가 캐시·조회·생성 순으로 확보한다. 저장만 하고 ingest는 별도 요청이다 |

내보낸 문서의 Wiki 편입은 문서 계열 경로
(`documents/{document_id}/ingest` 또는 `convert-markdown`)로 이어진다. [document.md](document.md) 참조.

## 유지보수(Lint)

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/wiki/maintenance/status` | Lint 필요 여부 확인 | `web/src/features/document-notifications/api/wikiLint.ts` `fetchWikiMaintenanceStatus` | `workspacePath(getWorkspaceId(), "wiki", "maintenance", "status")` | `cache: no-store` | `needs_lint`, `last_lint_at`, `last_wiki_change_at` | 알림 배지의 근거 |
| `POST /api/workspaces/{workspace_id}/wiki/maintenance/lint` | Lint 실행 또는 dry-run | `web/src/features/document-notifications/api/wikiLint.ts` `requestWikiLint` | `workspacePath(getWorkspaceId(), "wiki", "maintenance", "lint")` | `{ dry_run }` | `run_id` | backend는 `dry_run: false`를 명시하지 않으면 dry-run으로 처리한다. 이 저장소는 항상 명시한다 |
| `GET /api/workspaces/{workspace_id}/wiki/maintenance/runs/{run_id}` | Lint run 상태 폴링 | `web/src/features/document-notifications/api/wikiLint.ts` `requestWikiLint` 내부 | `workspacePath(getWorkspaceId(), "wiki", "maintenance", "runs", queued.run_id)` | `cache: no-store` | `status`, `error`, `manifest.task_result.changed_pages` | SSE가 아닌 **폴링**(`pollUntil`, `web/src/shared/lib/pollUntil.ts`). run 레코드 생성 지연을 고려해 `404`를 "계속 폴링"으로 해석한다. `succeeded`면 `changed_pages.length`를 센다 |

## UI 위치

- Wiki 페이지 본문 보기·편집: `web/src/features/wiki-page-editing` (`web/src/widgets/source-preview/ui/SourcePreviewPanel.tsx`에서 쓴다)
- 그래프 뷰: `web/src/widgets/graph/ui`, `web/src/widgets/graph/model`
- Wiki 편입 상태·확인: `web/src/features/wiki-ingest/ui`, `web/src/features/wiki-ingest/model`
- Lint 알림: `web/src/features/document-notifications/ui`

## 호출하지 않는 Wiki 경로

`wiki/pages/{wiki_page_id}/diff`, `wiki/pages/{wiki_page_id}/rename`,
`chat/sessions/{session_id}/wiki/preview`, 그리고 `wiki-schema/**` 4개. [uncalled.md](../uncalled.md) 참조.
