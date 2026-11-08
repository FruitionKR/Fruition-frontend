# 워크스페이스 소비 API

[API 배선 문서](../README.md) / [소비 API](README.md)

access-svc가 받는 워크스페이스 자체 CRUD·아이콘·멤버십·초대다. `next.config.mjs` rewrite가
이 경로들을 명시적으로 access-svc로 보낸다. 직접 전송 정규식에 포함되지 않으므로 항상
동일 출처 rewrite를 경유한다.

- 호출 지점: 18
- 호출 경로: 12

## 워크스페이스

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces` | 내가 속한 워크스페이스 목록 | `web/src/entities/workspace/api/workspace.ts` `fetchWorkspaces` | 리터럴 | `cache: no-store` | `WorkspaceListResponse` 전체 (`free_workspace_count`, `free_workspace_limit`, 각 항목의 `auto_ingest_on_upload` 포함) | 워크스페이스 선택 화면(`web/src/views/workspaces/ui`)의 진입 호출. 사이드바 워크스페이스 메뉴는 무료 소유 한도에 닿으면 새 워크스페이스 버튼을 막는다. 두 필드는 **백엔드 미구현(요구사항)**이라 없으면 막지 않는다 |
| `POST /api/workspaces` | 워크스페이스 생성 | `web/src/entities/workspace/api/workspace.ts` `createWorkspace` | 리터럴 | `{ name }` | `WorkspaceResponse` | `ERROR_MESSAGES.workspaceCreateFailed`. 409 `WORKSPACE_LIMIT_EXCEEDED`는 `describeLimitError`의 정해 둔 문구로 안내한다 |
| `PATCH /api/workspaces/{workspace_id}` | 워크스페이스 이름 변경 | `web/src/entities/workspace/api/workspace.ts` `renameWorkspace` | `workspacePath(workspaceId)` | `{ name }` | `WorkspaceResponse` | - |
| `PATCH /api/workspaces/{workspace_id}` | 업로드 자동 편입 설정 변경 | `web/src/entities/workspace/api/workspace.ts` `updateWorkspaceAutoIngest` | `workspacePath(workspaceId)` | `{ auto_ingest_on_upload }` (`name` 없이) | `WorkspaceResponse` | OWNER만. 그 외에는 이름 변경과 같은 규칙으로 404다. 설정 > 워크스페이스 설정의 토글(`WorkspacePanel`)이 OWNER가 아니면 비활성화한다. 켜도 업로더에게 `wiki.ingest`가 있을 때만 변환 뒤 자동 편입된다(access #32) |

## 아이콘

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `PUT /api/workspaces/{workspace_id}/icon` | 이모지 아이콘 설정·해제 | `web/src/entities/workspace/api/workspace.ts` `updateWorkspaceIcon` | `workspacePath(workspaceId, "icon")` | `{ icon_emoji }` (`null`로 해제) | `WorkspaceResponse` | - |
| `PUT /api/workspaces/{workspace_id}/icon/image` | 아이콘 이미지 업로드 | `web/src/entities/workspace/api/workspace.ts` `uploadWorkspaceIcon` | `workspacePath(workspaceId, "icon", "image")` | `FormData` `file` | `WorkspaceResponse` | `Content-Type`을 직접 지정하지 않고 브라우저 boundary에 맡긴다 |
| `GET /api/workspaces/{workspace_id}/icon/image` | 아이콘 이미지 조회 | `web/src/entities/workspace/api/workspace.ts` `fetchWorkspaceIcon` | `workspacePath(workspaceId, "icon", "image")` | `cache: no-store` | 응답 `Blob` | Bearer가 필요해 `<img src>`로 직접 못 쓰고 `apiFetch` + Blob으로 받는다 |

## 멤버

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/members` | 멤버 목록 | `web/src/entities/workspace/api/members.ts` `fetchMembers` | `workspacePath(workspaceId, "members")` | `cache: no-store` | `members[]` (`user_id`, `email`, `display_name`, `avatar_url`, `provider`, `role`, `permissions`, `joined_at`) | `permissions`는 정렬된 권한 항목 배열이고 OWNER는 항상 다섯 개 전부다. 멤버 관리(`MembersPanel`)가 행마다 칩으로 보여 주고, 본인 항목은 "내 권한 항목"으로 읽기 전용 표시한다. `avatar_url`은 `GET /api/users/{user_id}/avatar?v=…`이며 사진이 없으면 `null`. 멤버 관리 목록이 `UserAvatar`로 보여 준다([auth-account.md](auth-account.md) 프로필 사진) |
| `PATCH /api/workspaces/{workspace_id}/members/{user_id}` | 멤버 역할 변경 | `web/src/entities/workspace/api/members.ts` `changeMemberRole` | `workspacePath(workspaceId, "members", userId)` | `{ role }` (`OWNER`/`MEMBER`) | `WorkspaceMember` | 역할 유니온은 프런트에서 `WorkspaceRole`로 고정. 역할과 권한 항목은 독립이라 역할을 바꿔도 `permissions`는 그대로다 |
| `PATCH /api/workspaces/{workspace_id}/members/{user_id}` | 멤버 권한 항목 변경 | `web/src/entities/workspace/api/members.ts` `updateMemberPermissions` | `workspacePath(workspaceId, "members", userId)` | `{ permissions }` (전체 교체. 값은 `web/src/shared/lib/workspacePermissions.ts` `WORKSPACE_PERMISSIONS`의 `wiki.ingest`·`wiki.lint`·`skill.author`·`wiki.restore`·`document.convert`) | `WorkspaceMember` | OWNER만(그 외 403). 칩 하나를 켜고 끌 때 현재 목록에 더하거나 뺀 전체를 보낸다. OWNER 행은 켜진 채 비활성화해 `400 OWNER_PERMISSIONS_FIXED`를 내지 않는다. 알 수 없거나 중복된 값은 `400 INVALID_REQUEST` |
| `DELETE /api/workspaces/{workspace_id}/members/{user_id}` | 멤버 제거 | `web/src/entities/workspace/api/members.ts` `removeMember` | `workspacePath(workspaceId, "members", userId)` | 본문 없음 | - (`throwIfNotOk`) | - |

## 초대

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/invitations` | 초대 메일 발송 | `web/src/entities/workspace/api/members.ts` `inviteMember` | `workspacePath(workspaceId, "invitations")` | `{ email, role }` | - (`throwIfNotOk`) | - |
| `GET /api/invitations/{token}` | 초대 링크 내용 미리보기 | `web/src/entities/workspace/api/invitations.ts` | 템플릿 결합 (`encodeURIComponent(token)`) | `cache: no-store` | 초대 정보 | raw `fetch`. 수신자가 아직 로그인하지 않았을 수 있어 Bearer를 붙이지 않는다. 최상위 경로이고 middleware `OPEN_API_PATTERNS`에 포함된다 |
| `POST /api/invitations/{token}/accept` | 초대 수락 | `web/src/entities/workspace/api/invitations.ts` | 템플릿 결합 (`encodeURIComponent(token)`) | 본문 없음 | - | `apiFetch`. 수락은 로그인 상태를 요구하므로 Bearer를 붙인다 |

## 워크스페이스 MCP 관리

설정 > 워크스페이스 설정의 OWNER 전용 섹션이 `web/src/entities/workspace/api/mcp.ts`를 사용한다. 화면의 OWNER 판정은
컨트롤 노출 힌트일 뿐이며 access-svc가 모든 요청에서 현재 OWNER를 다시 확인한다. 정책과 연결 캐시는 선택 워크스페이스와
현재 사용자로 나뉘고, 워크스페이스 전환 시 draft·페이지 상태도 새 컴포넌트로 초기화된다.

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/mcp-policy` | 현재 MCP 허용 정책 조회 | `fetchWorkspaceMcpPolicy` | `workspacePath(workspaceId, "mcp-policy")` | `cache: no-store` | `workspace_id`, `enabled`, `allowed_scopes`, nullable `generation`·`updated_at` | 정책이 없으면 서버가 `enabled:false`, 빈 scope, nullable 메타데이터를 반환한다. UI가 오류를 꺼짐으로 대체하지 않는다 |
| `PUT /api/workspaces/{workspace_id}/mcp-policy` | MCP 허용 여부와 scope 전체 교체 | `updateWorkspaceMcpPolicy` | 같은 경로 | 정확히 `{ enabled, allowed_scopes }`; scope는 `read`·`write_propose`·`wiki_write`, 빈 배열 허용 | 위와 같은 authoritative policy | 명시적 저장만 호출한다. 끄기·scope 변경은 확인 창을 거치며 성공 뒤 정책과 연결 페이지를 다시 조회한다. 변경은 과거 grant를 회수하므로 재연결이 필요하다 |
| `GET /api/workspaces/{workspace_id}/mcp-connections?page={page}&size={size}` | OWNER가 워크스페이스 전체 연결 조회 | `fetchWorkspaceMcpConnections` | `workspacePath` + `URLSearchParams` | 0부터 시작하는 `page`, 고정 `size=20`, `cache:no-store` | `connections`, `page`, `size`, `has_next`; 행은 개인 연결 8필드 + `user_id` | 서버 정렬·페이지를 그대로 쓴다. 이름/last-used는 계약에 없고 만들지 않는다. Access 구현 보고서는 이 경로와 계약 테스트 완료를 기록했지만, 이 프런트 작업에서 실제 결합 E2E를 수행한 것은 아니다 |
| `DELETE /api/workspaces/{workspace_id}/mcp-connections/{grant_id}` | OWNER 강제 회수 | `revokeWorkspaceMcpConnection` | 모든 segment를 인코딩하는 `workspacePath` | 본문 없음 | 204 body 없음 | `ACTIVE`·`USER_DISCONNECTED`만 화면에서 회수 가능하다. 204/404는 해당 workspace/user 캐시 행을 지운 뒤 재조회하고, 5xx는 목록을 바꾸지 않는다. 서버는 강한 `SECURITY_REVOKED`·`PURGED`를 낮추지 않는다 |

로컬 proxy는 위 세 정확한 route shape를 `next.config.mjs`에서 access-svc로 보낸다. `SAME_ORIGIN_API=true`에서는 Next rewrite가
없으므로 ALB가 같은 세 경로를 access-svc로 소유해야 한다. 기존 `/oauth2/authorize`, 개인 `/api/mcp/connections/**`,
소셜 로그인 경로는 유지한다. 실제 ALB 규칙과 Access 병렬 구현을 합친 E2E는 배포 전 별도 게이트다.

## 권한 항목이 없을 때 (document #116)

편입(수동 편입·채팅 내보내기 문서의 편입)·lint·남이 올린 PDF 변환·남이 실행한 AI 작업 되돌리기·팀 스킬 작성은
권한 항목이 없으면 document-svc가 `403` `WORKSPACE_PERMISSION_REQUIRED`로 거절한다. 메시지에 필요한 항목(`'wiki.ingest'`)이 들어 있다.
`web/src/shared/lib/apiErrors.ts` `getErrorMessage`가 이 응답을 "이 작업에는 '위키 편입' 권한이 필요합니다. 워크스페이스 OWNER에게 권한을 요청하세요."로 바꾸므로,
`getErrorMessage`를 거치는 호출처(`useGraphWikiActions`, `usePdfWikiIngest`, `useProjectTree`의 Markdown 변환, `LogView`의 롤백, 스킬 작성·게시)는 별도 분기 없이 같은 안내를 보여 준다.

위키 편입·위키 최신화는 403이 나기 전에 화면에서 막는다. 본인 권한은 멤버 목록 응답의 `role`·`permissions`로 판단하고(`hasWorkspacePermission`, OWNER는 항상 허용),
`web/src/features/wiki-ingest/model/wikiActionPermission.ts` `getWikiActionGate`가 버튼 상태를 정한다. 권한이 없으면 버튼을 막고 "위키 편입 권한이 없어요"·"위키 최신화 권한이 없어요"를 말풍선·툴팁으로 보여 주고,
역할을 확인하는 중이면 사유 없이 막는다. 진입점별로 그래프 레일의 위키 편입·위키 최신화(`GraphRailActions`), 채팅 답변 근거 안내의 편입 버튼(`HomeWorkspace` → `AgentPanel`), 편입·최신화 제안 카드(`DocumentProcessingNotifications`)가 이 값을 쓰고,
`useGraphWikiActions`는 권한이 확실할 때(`true`)만 ingest·convert·lint 요청을 보낸다. 채팅 내보내기(`chat/sessions/{id}/wiki`)는 원문 문서 저장만 해서 권한 항목이 필요 없다(편입은 그 문서로 따로 요청).

## UI 위치

- 워크스페이스 선택·생성: `web/src/views/workspaces/ui`
- 아이콘·멤버·초대·MCP 정책/연결 관리: `web/src/features/user-settings/ui`, `web/src/entities/workspace`
- 초대 수신 화면: `web/src/views/invitation/ui`
