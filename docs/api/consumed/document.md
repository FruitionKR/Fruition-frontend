# 문서·트리 소비 API

[API 배선 문서](../README.md) / [소비 API](README.md)

document-svc의 문서·폴더·본문 API다. 이 경로군은 전부 직접 전송 정규식
(`documents|document-tree|folders`)에 걸리므로 `BACKEND_URL`이 설정된 배포에서는 rewrite를
우회해 document-svc 오리진으로 직접 나간다. 관리 이미지(`assets`)만 예외로 rewrite를 경유한다.

- 호출 지점: 31
- 호출 경로: 28 (권한 2·편집 충돌 3·알림 3은 공동 편집 릴리스(Fruition-document#85)에서 추가된 경로라 `/api/**` 87개 기준 집계에는 없다)

## 목록·트리

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/documents` | 문서 평면 목록 | `web/src/entities/document/api/document.ts` `fetchDocuments` / `web/src/entities/wiki/api/wiki.ts` `fetchDocumentData` | `workspacePath(workspaceId, "documents")` | `cache: no-store` | `documents[]` | 두 모듈이 같은 경로를 각자 호출한다 |
| `GET /api/workspaces/{workspace_id}/document-tree` | 폴더·문서 트리 | `web/src/entities/tree/api/documentTree.ts` `fetchDocumentTree` / `web/src/features/agent-chat/api/agentPlan.ts` `fetchPlanTree` | `workspacePath(workspaceId, "document-tree")` | `cache: no-store` | `items[]` (`id`, `name`, `type`, `children`, `current_version`, 폴더 `permission`) | 낙관적 잠금용 `current_version`과 이름 중복 검사의 근거 데이터다. `web/src/features/document-search`는 이 트리를 받아 **클라이언트에서 필터링**하며 backend 검색 API를 쓰지 않는다 |

## 업로드

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/documents` | 문서 업로드(단일 요청) | `web/src/entities/document/api/document.ts` `uploadDocumentFile` | `workspacePath(workspaceId, "documents")` | `FormData` `file` + 선택 `folder_id` | `DocumentUploadResponse` | `Idempotency-Key`. 직접 업로드가 꺼져 있거나 PDF가 아닐 때의 경로 |
| `POST /api/workspaces/{workspace_id}/documents/uploads` | multipart 업로드 개시 | `web/src/entities/document/api/multipartUpload.ts` `uploadPdfMultipart` | 호출자가 넘긴 `endpoint` = `workspacePath(workspaceId, "documents", "uploads")` | `{ filename, size, folder_id }` | `ticket`, `part_size`, `part_count` | PDF + `directUpload: true`일 때만. `part_count !== ceil(size/part_size)`면 요청을 중단한다 |
| `POST /api/workspaces/{workspace_id}/documents/uploads/parts` | 조각 presigned URL 발급 | `web/src/entities/document/api/multipartUpload.ts` | 템플릿 결합 (`` `${endpoint}/parts` ``) | `{ ticket, first_part, count }` | `parts[].part_number`, `parts[].url` | 3개 단위로 발급. 조각 재시도 시 1개만 재발급한다. `part_number` 순서를 검증한다 |
| `POST /api/workspaces/{workspace_id}/documents/uploads/complete` | 업로드 완료·문서 등록 | `web/src/entities/document/api/multipartUpload.ts` | 템플릿 결합 (`` `${endpoint}/complete` ``) | `{ ticket }` | `DocumentUploadResponse` | `Idempotency-Key`를 **재시도에서도 동일 키로** 보내 중복 문서를 막는다. `>= 500`은 최대 3회 재시도 |
| `POST /api/workspaces/{workspace_id}/documents/uploads/abort` | 실패한 조각 회수 | `web/src/entities/document/api/multipartUpload.ts` | 템플릿 결합 (`` `${endpoint}/abort` ``) | `{ ticket }` | - | 실패 경로에서만 호출하며 결과를 무시한다(`.catch(() => undefined)`) |

조각 본문 자체는 `parts[].url`(S3 presigned)로 `credentials: "omit"` raw `fetch` `PUT`을 보낸다.
backend API가 아니므로 표에 넣지 않는다. 동시 3개, 조각별 최대 3회, 지수 백오프 500ms·1s.

## 저장 용량

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/storage` | 플랜·사용량·용량 조회 | 없음(프론트는 호출하지 않는다) | - | - | - | **백엔드 요구사항(보류)**. 플랜·용량 정책을 정할 때 백엔드에서 한도 적용(`STORAGE_QUOTA_EXCEEDED`)과 함께 구현할 요구사항이다. 현재 document-svc에는 이 API와 워크스페이스 용량 한도가 없고 파일당 50MB multipart 제한만 있다. 프론트는 업로드 전 용량 사전 검사를 하지 않고 서버 판단에 맡긴다 |

업로드 실패의 `error.code`가 `STORAGE_QUOTA_EXCEEDED`면 서버 message 대신
`describeLimitError`(`web/src/entities/workspace/model/workspaceLimits.ts`)의 정해 둔 문구를 보여 준다.

## 문서 상세·조작

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/documents/{document_id}` | 문서 상세 조회 | `web/src/entities/document/api/document.ts` (`deleteDocument`, `renameDocument`) / `web/src/features/note-editing/api/note.ts` `fetchNoteDraft` | `workspacePath(workspaceId, "documents", documentId)` | `cache: no-store` | `current_version`, `filename`, `markdown`, `edit_revision`, `updated_at`, `id` | 삭제·이름 변경이 `base_version`을 얻기 위해 먼저 부른다. 노트 편집기는 `404`를 `null`(편집본 없음)로 해석한다 |
| `DELETE /api/workspaces/{workspace_id}/documents/{document_id}` | 문서 소프트 삭제 | `web/src/entities/document/api/document.ts` `deleteDocument` | `workspacePath(workspaceId, "documents", documentId)` | `{ base_version }` | - (`throwIfNotOk`) | `idempotentJsonHeaders()`. 직전 상세 조회의 `current_version`이 유한한 수가 아니면 요청하지 않고 실패시킨다 |
| `PATCH /api/workspaces/{workspace_id}/documents/{document_id}/rename` | 표시명 변경 | `web/src/entities/document/api/document.ts` `renameDocument` | `workspacePath(workspaceId, "documents", documentId, "rename")` | `{ display_name, base_version }` | - (`throwIfNotOk`) | 확장자를 떼어 `display_name`을 만들고, 같은 폴더 내 이름 중복은 트리 조회로 **서버 호출 전에** `DocumentNameConflictError`로 막는다 |
| `PATCH /api/workspaces/{workspace_id}/documents/{document_id}/position` | 문서 이동·순서 변경 | `web/src/entities/tree/api/documentTree.ts` `moveDocument` (`mutateTreeItem`) | `workspacePath(workspaceId, "documents", id, "position")` (`...suffix` 전개) | `{ folder_id, position, base_version }` | - (`throwIfNotOk`) | `idempotentJsonHeaders()`. 트리에서 항목 타입이 `document`가 아니면 호출하지 않는다 |
| `GET /api/workspaces/{workspace_id}/documents/{document_id}/original` | 원본 파일 조회 | `web/src/entities/document/api/document.ts` `fetchDocumentOriginal` | `workspacePath(workspaceId, "documents", documentId, "original")` | `cache: no-store` | 응답 `Blob` | Bearer가 필요해 iframe/`<embed>` 직접 지정이 불가해 Blob으로 받는다 |
| `GET /api/workspaces/{workspace_id}/documents/{document_id}/original-url` | 원본 presigned 조회 URL | `web/src/entities/document/api/document.ts` `fetchDocumentReadUrl` | `workspacePath(getWorkspaceId(), "documents", documentId, "original-url")` | `cache: no-store` | `url` (`null` 가능) | 원본 뷰어(`web/src/widgets/source-preview/ui`)가 Blob 대신 쓸 수 있는 경로 |
| `GET /api/workspaces/{workspace_id}/documents/{document_id}/blocks` | 근거 하이라이트용 원본 block 목록 | `web/src/entities/document/api/document.ts` `fetchDocumentBlocks` | `workspacePath(getWorkspaceId(), "documents", documentId, "blocks")` | `cache: no-store` | `is_stale`, `blocks[].block_id`, `blocks[].line_start`, `blocks[].line_end`, `blocks[].text` | 원본 미리보기가 근거 하이라이트를 열 때만 부른다(react-query `["document-blocks", documentId]`). block ID는 영구 ID라 본문을 다시 잘라 순번을 매기지 않는다. `is_stale === false`면 서버 줄 범위를 쓰고, 그 외(`true`·`null`·필드 없는 구 응답·범위 `null`)는 정규화 `text`를 현재 본문에서 줄 경계 기준으로 찾는다(`web/src/entities/document/lib/sourceBlockRanges.ts`). 못 찾은 근거는 하이라이트하지 않고 안내만 띄운다 |

## 본문 편집

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `PUT /api/workspaces/{workspace_id}/documents/{document_id}/content` | Markdown 본문 저장 | `web/src/features/note-editing/api/note.ts` `saveNoteDraft` | `workspacePath(workspaceId, "documents", documentId, "content")` | `FormData`. 첨부 없음: `markdown`(Blob part `content.md`), `base_revision`, `revision_write_id`, 선택 `source`. 첨부 있음: `metadata` JSON(`{ markdown, base_version }`) + `attachment_<uuid>` 파일 part. `source === "agent"`면 `apply_operation_id` | `document_id`, `markdown`, `current_version`, `updated_at`, `attachments[]` | `409` → `NoteContentConflictError`. 본문을 문자열 part가 아닌 Blob으로 보내 LF→CRLF 변환을 피한다. 첨부 경로는 `revision_write_id`를 보내지 않고 서버가 `base_version`·본문 해시·첨부 해시로 쓰기 ID를 결정한다 |
| `GET /api/workspaces/{workspace_id}/assets/{asset_id}/content` | 본문 속 관리 이미지 조회 | `web/src/shared/api/assets.ts` `acquireAssetObjectUrl` | 본문에서 정규식으로 추출한 경로 | `cache: no-store` | 응답 `Blob` → object URL | 직접 전송 정규식에 `assets`가 없어 rewrite를 경유한다. 참조 계수로 revoke 관리 |

## 폴더

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/folders` | 폴더 생성 | `web/src/entities/tree/api/documentTree.ts` `createFolder` | `workspacePath(getWorkspaceId(), "folders")` | `{ name, parent_folder_id }` | `FolderResponse` | - |
| `PATCH /api/workspaces/{workspace_id}/folders/{folder_id}` | 폴더 이름 변경 | `web/src/entities/tree/api/documentTree.ts` `renameFolder` (`mutateTreeItem`) | `workspacePath(workspaceId, "folders", id)` (빈 `suffix`) | `{ name, base_version }` | - (`throwIfNotOk`) | `idempotentJsonHeaders()` |
| `DELETE /api/workspaces/{workspace_id}/folders/{folder_id}` | 폴더 삭제 | `web/src/entities/tree/api/documentTree.ts` `deleteFolder` (`mutateTreeItem`) | `workspacePath(workspaceId, "folders", id)` (빈 `suffix`) | `{ base_version }` | - (`throwIfNotOk`) | `idempotentJsonHeaders()`. DELETE에 본문을 보내는 계약이다 |
| `PATCH /api/workspaces/{workspace_id}/folders/{folder_id}/position` | 폴더 이동·순서 변경 | `web/src/entities/tree/api/documentTree.ts` `moveFolder` (`mutateTreeItem`) | `workspacePath(workspaceId, "folders", id, "position")` | `{ parent_folder_id, position, base_version }` | - (`throwIfNotOk`) | `idempotentJsonHeaders()` |

## 공동 편집 권한

목록·트리·상세 응답의 `can_edit`·`can_delete`·`permission`·`updated_by`(`DocumentItemResponse`)로 화면이 읽기 전용 여부를 정한다.
`can_edit === false`만 읽기 전용이고, 필드가 없는 구 응답은 편집 가능으로 본다(`web/src/entities/document/lib/documentAccess.ts`).

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `PUT /api/workspaces/{workspace_id}/documents/{document_id}/permission` | 문서 권한 설정 | `web/src/entities/document/api/permission.ts` `setDocumentPermission` (`putPermission`) | `workspacePath(getWorkspaceId(), "documents", documentId, "permission")` | `{ access: "edit" \| "view" \| null }` | `access` | 문서 소유자·OWNER만. `403 DOCUMENT_WRITE_FORBIDDEN`은 `describePermissionError`가 역할 안내 문구로 바꾼다 |
| `PUT /api/workspaces/{workspace_id}/folders/{folder_id}/permission` | 폴더 권한 설정 | `web/src/entities/document/api/permission.ts` `setFolderPermission` (`putPermission`) | `workspacePath(getWorkspaceId(), "folders", folderId, "permission")` | `{ access }` | `access` | OWNER만. 폴더 안 문서·하위 폴더가 따른다. 다이얼로그는 트리 응답의 폴더 `permission`에서 시작하고, 없으면 `null`(상위 따름)에서 시작한다 |

### `can_convert` — Markdown 변환 가능 여부

목록·트리·상세 응답의 문서 항목에 `can_convert: boolean`을 `can_edit`·`can_delete`와 같은 자리로 받는다.
값은 `convert-markdown` 판정과 같은 규칙이다: 올린 사람은 자기 PDF를 변환할 수 있고, 그 외에는 워크스페이스 `document.convert` 권한이 필요하며 OWNER는 항상 가능하다. 변환 대상이 아닌 문서는 `false`다.

- `can_convert === false`면 문서 트리 우클릭 "Markdown으로 변환"을 비활성화하고 "다른 사람이 올린 PDF는 변환 권한이 있어야 해요"를 툴팁·`aria-description`으로 알린다. 요청은 보내지 않는다(`web/src/widgets/workspace/model/useProjectTree.ts`).
- 위키 편입 선택 트리도 같은 이유로 그 PDF를 고르지 못하게 하고(`getGraphIngestBlockReason`), PDF 편입 흐름(`usePdfWikiIngest.startPdfIngest`)은 convert 요청 전에 같은 이유로 실패시킨다.
- 필드가 없는 구 응답은 지금처럼 요청을 보내고 서버 판정(403)에 맡긴다(`canConvertDocument`, `web/src/entities/document/lib/documentAccess.ts`).
- mock(`web/mock/state.mjs` `canConvertDocument`·`mayConvertDocument`)은 같은 규칙으로 `can_convert`를 내려 주고, `convert-markdown`은 권한이 없으면 `403 WORKSPACE_PERMISSION_REQUIRED`를 돌려준다.

### 트리의 폴더 `permission` — 백엔드 추가 필요(제안)

`GET /document-tree`의 `type: "folder"` 항목에 폴더 자기 권한 `permission: "edit" | "view" | null`을 내려 주길 제안한다
(`null`은 상위 설정 따름, `PUT .../folders/{folder_id}/permission`으로 저장한 값과 같다). 문서 항목은 이미 `document.permission`이 있다.

- 프론트는 이 필드가 있으면 폴더 행에 자기 권한(자물쇠·연필)을, 상위 설정 따름 항목에는 가장 가까운 권한 있는 상위 폴더의 권한을 흐린 아이콘과
  "보기만 가능 (상위 폴더 '{폴더명}'에서 상속)" 안내로 보여 준다(`web/src/entities/tree/lib/treePermission.ts`).
- 필드가 없는 현재 백엔드 응답에서는 폴더 권한과 그로부터의 상속 표시가 나오지 않는다(문서 자기 권한 표시만 동작).
- mock(`web/mock/routes/folders.mjs` `buildTree`)은 이 제안 계약대로 폴더 `permission`을 내려 준다.

## 편집 충돌

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/documents/{document_id}/conflicts` | 저장 409 뒤 내 본문을 충돌로 등록 | `web/src/features/note-editing/api/editConflict.ts` `registerEditConflict` | `workspacePath(getWorkspaceId(), "documents", documentId, "conflicts")` | `{ markdown, base_revision, client_conflict_id }` | - (성공 여부만) | `useNoteAutosave`가 `PUT .../content` 409(`error.current_revision` → `NoteContentConflictError.currentRevision`) 직후 호출한다. `client_conflict_id`는 편집 세션마다 하나라 재전송이 중복 등록되지 않는다 |
| `GET /api/workspaces/{workspace_id}/conflicts` | OWNER용 미해결 충돌 목록 | `web/src/features/note-editing/api/editConflict.ts` `fetchEditConflicts` | `workspacePath(getWorkspaceId(), "conflicts")` | `cache: no-store` | `conflicts[].conflict`(`id`, `base_revision`, `markdown`, `author_user_id`, `created_at`), `document_name`, `server`(`markdown`, `revision`, `updated_by`) | 설정 화면 편집 충돌 섹션(`web/src/features/user-settings/ui/panels/collab/EditConflictSection.tsx`). `useWorkspaceRole`로 OWNER일 때만 조회한다 |
| `POST /api/workspaces/{workspace_id}/conflicts/{conflict_id}/resolve` | 충돌 해결 | `web/src/features/note-editing/api/editConflict.ts` `resolveEditConflict` | `workspacePath(getWorkspaceId(), "conflicts", conflictId, "resolve")` | `{ choice }` 또는 `{ choice, base_revision }`(`conflict`), `{ choice, base_revision, markdown }`(`merged`) — `buildResolveRequest` | - (목록 재조회) | 화면은 `server`·`conflict`만 보낸다(합치기 편집기 없음). `409 CONFLICT_ALREADY_RESOLVED`·`409 DOCUMENT_VERSION_CONFLICT`·`423`은 `describeResolveError`가 분기한다 |

## 앱 안 알림

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/notifications` | 알림 목록 | `web/src/features/document-notifications/api/notifications.ts` `fetchNotifications` | `workspacePath(getWorkspaceId(), "notifications")` + `URLSearchParams`(`unread_only`, `limit`, `before`, `before_id`) | `cache: no-store` | `notifications[]`(`id`, `type`, `payload`, `read`, `created_at`) | 우하단 카드(`useServerNotifications`, `unread_only=true` 30초 폴링, 첫 폴링은 카드로 띄우지 않음)와 레일 알림 화면 워크스페이스 탭(`useNotificationFeed`, `limit=50`, 보는 중 5초·그 외 30초 폴링)이 쓴다. `type`별 문구는 `describeNotification` |
| `POST /api/workspaces/{workspace_id}/notifications/{notification_id}/read` | 읽음 처리 | 같은 파일 `markNotificationRead` | `workspacePath(getWorkspaceId(), "notifications", notificationId, "read")` | 본문 없음 | - (`throwIfNotOk`) | 성공 시 목록 캐시를 `markRead`로 갱신한다 |
| `POST /api/workspaces/{workspace_id}/notifications/read-all` | 모두 읽음 | 같은 파일 `markAllNotificationsRead` | `workspacePath(getWorkspaceId(), "notifications", "read-all")` | 본문 없음 | - (`throwIfNotOk`) | - |

## 휴지통

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/documents/trash` | 삭제 문서 목록 | `web/src/entities/document/api/trash.ts` `fetchTrashDocuments` | `workspacePath(getWorkspaceId(), "documents", "trash")` | `cache: no-store` | `documents[]`(`id`, `filename`, `display_name`, `current_version`, `deleted_at`, `purge_at`) | 설정 화면 휴지통 섹션. `purge_at`으로 "N일 뒤 영구 삭제"를 보여주고(`web/src/entities/document/lib/trashRetention.ts`), 지난 항목은 복구 버튼을 막는다 |
| `POST /api/workspaces/{workspace_id}/documents/{document_id}/restore` | 삭제 문서 복구 | `web/src/entities/document/api/trash.ts` `restoreTrashDocument` | `workspacePath(getWorkspaceId(), "documents", documentId, "restore")` | `{ base_version }` (목록의 `current_version`) | - (목록·트리 재조회) | `idempotentJsonHeaders()`. `409 TRASH_RETENTION_EXPIRED`·`409 WORKSPACE_TRASH_EXPIRED`는 `describeRestoreError`가 보관 기간 문구로 바꾼다. 워크스페이스 휴지통 화면은 아직 없다 |

## Wiki 편입 진입점

문서를 Wiki로 반영하는 두 경로는 문서 종류에 따라 갈린다
(`web/src/entities/document/api/document.ts` `reflectDocumentToWiki`).

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/documents/{document_id}/ingest` | Wiki 편입 시작 | `web/src/entities/document/api/document.ts` `startDocumentIngest` (비공개) | `workspacePath(workspaceId, "documents", documentId, "ingest")` | 본문 없음 | - (`throwIfNotOk`) | `documentRole === "EDITABLE"`일 때만 호출한다. ingest가 편집 가능 Markdown만 받기 때문 |
| `POST /api/workspaces/{workspace_id}/documents/{document_id}/convert-markdown` | PDF 등 원본을 Markdown으로 변환 | `web/src/entities/document/api/document.ts` `convertDocumentToMarkdown` | `workspacePath(workspaceId, "documents", documentId, "convert-markdown")` | 본문 없음 | `DocumentItemResponse` (`id`) | `Idempotency-Key`. `EDITABLE`이 아닌 문서의 Wiki 반영 경로이기도 하다. `can_convert === false`면 보내지 않는다(공동 편집 권한의 `can_convert` 절). 응답 `id`로 변환 완료 후 자동 열기 이벤트(`publishConvertStarted`)를 발행한다 |

## UI 위치

- 업로드: `web/src/features/document-upload/ui`
- 사이드바 트리·이름 변경·이동·삭제: `web/src/widgets/document-sidebar/ui`
- 노트 편집기: `web/src/features/note-editing/ui`
- 원본 미리보기: `web/src/widgets/source-preview/ui`
- 검색(클라이언트 필터): `web/src/features/document-search/model/useDocumentSearch.ts`, `web/src/features/document-search/ui`
- 권한 설정 다이얼로그: `web/src/widgets/document-sidebar/ui/PermissionDialog.tsx`
- 편집 충돌·휴지통 목록(설정 > 문서 관리): `web/src/features/user-settings/ui/panels/collab/EditConflictSection.tsx`, `TrashSection.tsx`
- 서버 알림 목록·읽음 처리(레일 알림 화면 워크스페이스 탭): `web/src/widgets/notifications-view/model/useNotificationFeed.ts`, `lib/serverNotificationItems.ts`
