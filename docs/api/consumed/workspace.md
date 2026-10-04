# 워크스페이스 소비 API

[API 배선 문서](../README.md) / [소비 API](README.md)

access-svc가 받는 워크스페이스 자체 CRUD·아이콘·멤버십·초대다. `next.config.mjs` rewrite가
이 경로들을 명시적으로 access-svc로 보낸다. 직접 전송 정규식에 포함되지 않으므로 항상
동일 출처 rewrite를 경유한다.

- 호출 지점: 12
- 호출 경로: 9

## 워크스페이스

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces` | 내가 속한 워크스페이스 목록 | `src/entities/workspace/api/workspace.ts` `fetchWorkspaces` | 리터럴 | `cache: no-store` | `WorkspaceListResponse` 전체 | 워크스페이스 선택 화면(`src/views/workspaces/ui`)의 진입 호출 |
| `POST /api/workspaces` | 워크스페이스 생성 | `src/entities/workspace/api/workspace.ts` `createWorkspace` | 리터럴 | `{ name }` | `WorkspaceResponse` | `ERROR_MESSAGES.workspaceCreateFailed` |
| `PATCH /api/workspaces/{workspace_id}` | 워크스페이스 이름 변경 | `src/entities/workspace/api/workspace.ts` `renameWorkspace` | 템플릿 결합 (`` `/api/workspaces/${workspaceId}` ``) | `{ name }` | `WorkspaceResponse` | 이 저장소에서 `workspacePath`를 쓰지 않는 유일한 워크스페이스 경로다. 따라서 `workspaceId`가 `encodeURIComponent` 처리되지 않는다 |

## 아이콘

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `PUT /api/workspaces/{workspace_id}/icon` | 이모지 아이콘 설정·해제 | `src/entities/workspace/api/workspace.ts` `updateWorkspaceIcon` | `workspacePath(workspaceId, "icon")` | `{ icon_emoji }` (`null`로 해제) | `WorkspaceResponse` | - |
| `PUT /api/workspaces/{workspace_id}/icon/image` | 아이콘 이미지 업로드 | `src/entities/workspace/api/workspace.ts` `uploadWorkspaceIcon` | `workspacePath(workspaceId, "icon", "image")` | `FormData` `file` | `WorkspaceResponse` | `Content-Type`을 직접 지정하지 않고 브라우저 boundary에 맡긴다 |
| `GET /api/workspaces/{workspace_id}/icon/image` | 아이콘 이미지 조회 | `src/entities/workspace/api/workspace.ts` `fetchWorkspaceIcon` | `workspacePath(workspaceId, "icon", "image")` | `cache: no-store` | 응답 `Blob` | Bearer가 필요해 `<img src>`로 직접 못 쓰고 `apiFetch` + Blob으로 받는다 |

## 멤버

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/members` | 멤버 목록 | `src/entities/workspace/api/members.ts` `fetchMembers` | `workspacePath(workspaceId, "members")` | `cache: no-store` | `members[]` (`user_id`, `email`, `display_name`, `provider`, `role`, `joined_at`) | - |
| `PATCH /api/workspaces/{workspace_id}/members/{user_id}` | 멤버 역할 변경 | `src/entities/workspace/api/members.ts` `changeMemberRole` | `workspacePath(workspaceId, "members", userId)` | `{ role }` (`OWNER`/`MEMBER`) | `WorkspaceMember` | 역할 유니온은 프런트에서 `WorkspaceRole`로 고정 |
| `DELETE /api/workspaces/{workspace_id}/members/{user_id}` | 멤버 제거 | `src/entities/workspace/api/members.ts` `removeMember` | `workspacePath(workspaceId, "members", userId)` | 본문 없음 | - (`throwIfNotOk`) | - |

## 초대

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/invitations` | 초대 메일 발송 | `src/entities/workspace/api/members.ts` `inviteMember` | `workspacePath(workspaceId, "invitations")` | `{ email, role }` | - (`throwIfNotOk`) | - |
| `GET /api/invitations/{token}` | 초대 링크 내용 미리보기 | `src/entities/workspace/api/invitations.ts` | 템플릿 결합 (`encodeURIComponent(token)`) | `cache: no-store` | 초대 정보 | raw `fetch`. 수신자가 아직 로그인하지 않았을 수 있어 Bearer를 붙이지 않는다. 최상위 경로이고 middleware `OPEN_API_PATTERNS`에 포함된다 |
| `POST /api/invitations/{token}/accept` | 초대 수락 | `src/entities/workspace/api/invitations.ts` | 템플릿 결합 (`encodeURIComponent(token)`) | 본문 없음 | - | `apiFetch`. 수락은 로그인 상태를 요구하므로 Bearer를 붙인다 |

## UI 위치

- 워크스페이스 선택·생성: `src/views/workspaces/ui`
- 아이콘·멤버·초대 관리: `src/features/settings/ui`, `src/entities/workspace/ui`
- 초대 수신 화면: `src/views/invitation/ui`
