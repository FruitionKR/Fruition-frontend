# Wiki 소비 API

[API 배선 문서](../README.md) / [소비 API](README.md)

document-svc의 Wiki 조회·내보내기·유지보수 API다. `wiki/**`는 직접 전송 정규식에 **없어서**
rewrite를 경유하고, `chat/**`은 정규식에 있어 직접 전송 대상이다.

- 호출 지점: 11
- 호출 경로: 10

## 조회

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/wiki/graph` | Wiki 페이지 그래프 | `web/src/entities/wiki/api/wiki.ts` `fetchWikiGraph` | `workspacePath(getWorkspaceId(), "wiki", "graph")` | `cache: no-store`, 마지막 응답의 `ETag`가 있으면 `If-None-Match` | `WikiGraphResponse` 전체, `ETag` 헤더 | 그래프 위젯(`web/src/widgets/graph`)의 데이터 원천. `304`면 같은 워크스페이스에서 마지막으로 받은 그래프를 그대로 돌려준다(document #131). 캐시는 모듈 변수 하나이며 워크스페이스가 다르면 조건 없이 받는다 |
| `GET /api/workspaces/{workspace_id}/wiki/pages/{wiki_page_id}` | Wiki 페이지 상세 | `web/src/entities/wiki/api/wiki.ts` `fetchWikiPage` | `workspacePath(workspaceId, "wiki", "pages", pageId)` | `cache: no-store` | `WikiPageDetailResponse` 전체 | 그래프 노드 선택 시 본문을 채운다. 위키 페이지는 LLM이 정리한 내용이라 화면에서는 읽기 전용으로만 보여 준다. 본문 직접 저장 API(`PUT .../wiki/pages/{wiki_page_id}/content`, document #130)는 호출하지 않는다 |

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

## MCP Wiki 초안 명시적 승인

`web/src/features/mcp-approval/api/wikiDraftApproval.ts`가 아래 owner-partitioned Document API를 소비한다. 화면은
`/mcp/workspaces/{workspace_id}/wiki-drafts/{draft_id}`이고, 쿼리 캐시는 사용자·워크스페이스·초안으로 나뉜다.

| 메서드 + 경로 | 목적 | 보내는 것 | 쓰는 응답 | 비고 |
|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/mcp/wiki-drafts/{draft_id}` | 전체 미리보기·견적·공개·정산 상태 조회 | `cache: no-store` | exact `mcp.wiki-web-draft.v1` | 내부 `snapshot_id` 없이 `source_documents`와 `{document_id,block_id,quote}`만 받는다. `complete:true`와 전체 8종 cascade만 승인 가능하다. `UNKNOWN`/`NOT_FOUND` 결과와 `PENDING_RECONCILIATION`을 실패·무료로 바꾸지 않고 읽기 전용 조회만 반복한다 |
| `POST .../{draft_id}/approve` | 전체 초안 명시적 승인 | exact `{draft_id,draft_version,draft_hash,public_state_hash}` | 같은 detail DTO | 부분 선택·브라우저 가격·approval/operation ID를 보내지 않는다. 자동 호출·자동 재시도하지 않는다 |
| `POST .../{draft_id}/reject` | 전체 초안 거절 | exact `{}` | 같은 detail DTO | 일부 거절·로컬 수정 없음 |
| `POST .../{draft_id}/cancel` | 기존 task journal 취소 요청 | exact `{}` | 같은 detail DTO | 관리자 halt를 rollback으로 분류하지 않는다. 공개 뒤 복구는 새 API가 아니라 기존 작업 이력/restore 흐름을 쓴다 |

`quote`는 finalize/lint 성공 시 초안 버전·해시·원문 매핑에 서버가 한 번 고정한
`INGEST_SOURCE_QUANTITY | LINT_FIXED_APPLY` 견적이다. 브라우저는 `formula`를 표시만 하고 계산하지 않는다.
`client_name:null`인 적법한 연결 해제 이력도 읽되, 현재 WEB_APPROVAL에서 신뢰한 이름이 없으면 승인을 막는다.
404/410/413·402·409·403·503과 응답 불명확을 서로 다른 안내로 표시하며, 오래된 미리보기는 다시 승인하지 않는다.

## UI 위치

- Wiki 페이지 본문 보기(읽기 전용): `web/src/widgets/source-preview/ui/SourcePreviewPanel.tsx`
- 그래프 뷰: `web/src/widgets/graph/ui`, `web/src/widgets/graph/model`
- Wiki 편입 상태·확인: `web/src/features/wiki-ingest/ui`, `web/src/features/wiki-ingest/model`
- Lint 알림: `web/src/features/document-notifications/ui`

## 호출하지 않는 Wiki 경로

`wiki/pages/{wiki_page_id}/diff`, `wiki/pages/{wiki_page_id}/rename`,
`chat/sessions/{session_id}/wiki/preview`, 그리고 `wiki-schema/**` 4개. [uncalled.md](../uncalled.md) 참조.
