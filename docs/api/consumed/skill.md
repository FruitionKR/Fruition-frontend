# Skill 소비 API

[API 배선 문서](../README.md) / [소비 API](README.md)

document-svc의 Skill 작성·게시·설정 API다. `skills`는 직접 전송 정규식에 포함되므로
`BACKEND_URL`이 설정된 배포에서는 document-svc 오리진으로 직접 나간다.

- 호출 지점: 7
- 호출 경로: 6 — document-svc `skills` 계열 전체

이 도메인은 `workspacePath`를 쓰지 않고 템플릿 리터럴로 경로를 만든다. `deleteSkill`만
`encodeURIComponent`를 적용하고 나머지 6개는 적용하지 않는다.

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/skills` | Skill 목록 | `web/src/entities/skill/api/skill.ts` `fetchSkills` | 템플릿 결합 (`` `/api/workspaces/${workspaceId}/skills` ``) | `cache: no-store` | `SkillResponse[]` (배열 루트) | 응답이 envelope 없는 배열이다 |
| `POST /api/workspaces/{workspace_id}/skills/author` | Skill 초안 생성 | `web/src/entities/skill/api/skill.ts` `authorSkill` | 템플릿 결합 | `SkillAuthoringRequest` JSON | `SkillAuthoringResult` | 응답의 `capabilities`·`allowed_tools`는 사용자가 검토할 초안 권한이며 publish 요청에 그대로 전달한다 |
| `POST /api/workspaces/{workspace_id}/skills/author/publish` | 초안 게시 | `web/src/entities/skill/api/skill.ts` `publishSkill` | 템플릿 결합 | `SkillPublishRequest` JSON | `SkillAuthoringResult` | backend가 지침을 다시 보안 검사하며 권한이 확대되면 저장하지 않는다 |
| `PATCH /api/workspaces/{workspace_id}/skills/{skill_id}` | Skill 정의 수정 | `web/src/entities/skill/api/skill.ts` `updateSkill` | 템플릿 결합 | `SkillUpdateRequest` JSON | `SkillAuthoringResult` | - |
| `DELETE /api/workspaces/{workspace_id}/skills/{skill_id}` | Skill 삭제 | `web/src/entities/skill/api/skill.ts` `deleteSkill` | 템플릿 결합 (`encodeURIComponent` 적용) | 본문 없음 | - (`throwIfNotOk`) | 같은 경로를 PATCH와 공유한다 |
| `POST /api/workspaces/{workspace_id}/skills/{skill_id}/enable` | Skill 활성화 | `web/src/entities/skill/api/skill.ts` `enableSkill` | 템플릿 결합 | 본문 없음 | `SkillResponse` | - |
| `POST /api/workspaces/{workspace_id}/skills/{skill_id}/disable` | Skill 비활성화 | `web/src/entities/skill/api/skill.ts` `disableSkill` | 템플릿 결합 | 본문 없음 | `SkillResponse` | - |

## UI 위치

- `web/src/features/user-settings/ui/panels` (Skill 관리 패널)

## 인접 도메인: Wiki Schema

스킬 화면은 `wiki-schema/**`를 호출하지 않는다. 앱 어디에서도 렌더링되지 않던
`localStorage` 목업(`web/src/entities/schema`, `web/src/features/schema-manage`)은 제거했다.
document-svc의 `wiki-schema/**` 4개 경로는 미호출이다. [uncalled.md](../uncalled.md) 참조.
