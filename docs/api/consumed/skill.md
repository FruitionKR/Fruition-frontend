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

## 실행 옵션: `targets` · `result_mode` (ai#122)

문서 Skill(`capabilities`에 `document-create`·`document-edit`가 있는 Skill)만 가진다. 게시(`POST .../author/publish`)와
수정(`PATCH .../skills/{skill_id}`) 요청에 선택으로 싣고, 응답(`SkillAuthoringResult`, `SkillResponse.*_version`)에서 읽는다.
타입은 `web/src/entities/skill/model/skill.ts`(`SkillTargetValue`, `SkillResultModeValue`, `SkillExecutionOptions`).

| 필드 | 값 | 게시에서 생략 | 수정에서 생략 | 화면 |
|---|---|---|---|---|
| `targets` | `current_document`(현재 문서), `selection`(선택한 부분). 중복 불가, 저장 순서 고정 | `[]`과 같이 `["current_document"]` | 기존 값 유지(`[]`이면 기본값으로 되돌림) | 만들기 시트 '대상' 체크 |
| `result_mode` | `create`(새 문서로 만들기), `edit`(열린 문서 고치기), `auto`(상황에 맞게) | `null` | 기존 값 유지 | 만들기 시트 '결과 방식'. 상세 시트는 아래 불일치 때만 |

- `result_mode`는 `capabilities`와 정확히 맞아야 한다: `create`→`document-create`, `edit`→`document-edit`, `auto`→둘 다.
  게시는 프론트가 결과 방식으로 `capabilities`를 계산해 함께 보내므로 늘 맞는다(`skillPublishRequest`).
- **폴더 정리(`folder-organize`)·템플릿(`template`) Skill은 두 키를 빼고 보낸다**(`skillExecutionOptions`). 보내면 `400`.
  응답에서는 `targets: []`, `result_mode: null`로 온다.
- 필드가 생기기 전에 게시된 문서 Skill은 `targets: ["current_document", "selection"]`, `result_mode: null`로 읽힌다.
  프론트는 `result_mode`가 없으면 `capabilities`로 결과 방식을 추정한다(`kindFromCapabilities`, `skillRunIntent`).
- 상세 시트 저장(PATCH)은 이름·설명·지침과 문서 Skill의 `targets`만 보내고 `result_mode`는 생략한다. AI가 고친 지침을
  다시 분류해 `capabilities`가 바뀌면 이어받은 `result_mode`가 맞지 않아 **거절 없이 `null`로 버려진다**. 프론트는 응답에서
  이를 감지(`resultModeDrift`)해 시트를 닫지 않고 '결과 방식' 필드를 띄워, 고른 값을 `result_mode`로 실어 다시 저장한다.

### 오류 code

| AI code | 뜻 | document가 돌려주는 값 | 프론트 처리 |
|---|---|---|---|
| `invalid_result_mode` | `result_mode`가 `capabilities`와 맞지 않음, 또는 문서 Skill이 아닌데 보냄 | `400` `SKILL_REQUEST_REJECTED`("Skill 요청이 거부되었습니다.") — 전용 code로 옮기지 않음 | 결과 방식을 실어 보낸 PATCH가 이 code로 거절되면 결과 방식 불일치로 보고 상세 시트에 안내(`isResultModeRejection`). 전용 code(`invalid_result_mode`·`INVALID_RESULT_MODE`·`SKILL_RESULT_MODE_INVALID`)가 오면 그대로 인식 |
| `invalid_targets` | `targets` 중복, 또는 문서 Skill이 아닌데 보냄 | `400` `SKILL_REQUEST_REJECTED` | 일반 저장 실패 문구 |

## 스킬 화면에서 실행 (작업 탭 `POST /ai/agent/turn`)

스킬 목록의 '실행'은 사이드바에서 대상을 고른 뒤 작업 탭으로 **할 일 없이 `message: "/slug"`만** 보낸다
(`web/src/widgets/workspace/lib/skillRunTarget.ts`). AI는 `/slug`뿐인 턴을 라우터 없이 Skill의 결과 방식과 고른 대상으로 실행한다
(Fruition-ai `docs/api/agent.md` "할 일 없이 `/slug`만 보낸 턴"). 문장을 붙이면 라우터 판단이 끼어 '상황에 맞게'가 흔들린다.
문서 대상은 열린 문서 문맥(`documentId`·`baseVersion`·`editorSnapshot`)으로, 폴더는 `folder_id`로 함께 간다.

| 스킬 | 고를 수 있는 대상 | 함께 가는 것 | `folder_id` | AI 결과 |
|---|---|---|---|---|
| 폴더 정리 | 폴더 | - | 고른 폴더 | 그 폴더 정리 계획 |
| 템플릿 | 폴더 | - | 고른 폴더 | 새 문서 초안 |
| 새 문서로 만들기 | 문서 | 문서 문맥 | 문서가 있는 폴더(루트면 생략) | 그 문서를 원문으로 새 문서 초안 |
| 새 문서로 만들기 | 폴더 | - | 고른 폴더 | 새 문서 초안 |
| 열린 문서 고치기 | 문서 | 문서 문맥 | 생략 | 편집안 |
| 상황에 맞게 | 문서 | 문서 문맥 | 생략 | 되묻기(아래) |
| 상황에 맞게 | 폴더 | - | 고른 폴더 | 새 문서 초안 |

- 문서는 편집 권한이 있는 Markdown 문서만 고를 수 있다.
- `targets`가 `["selection"]`뿐인 문서 Skill은 사이드바 실행을 막고, 문서에서 부분을 선택한 뒤 채팅에 `/slug`를 입력하라고 안내한다.
- '상황에 맞게'의 되묻기(`action: "clarify"`, "새 문서로 만들까요, 지금 문서를 수정할까요?")에는 작업 카드에 '새 문서로 만들기'·'지금 문서 수정'
  버튼을 둔다. 누르면 열린 문서 문맥과 함께 `/slug 새 문서로 만들어 줘` 또는 `/slug 지금 문서를 수정해 줘`를 보낸다(슬래시를 빼면 Skill이 빠진다).
  '새 문서로 만들기'이고 사이드바에서 같은 문서로 실행했으면 그 문서가 있는 폴더를 `folder_id`로 싣는다
  (`web/src/features/agent-chat/lib/taskThread.ts` `skillModeQuestionSlug`·`SKILL_MODE_CHOICES`).

## UI 위치

- `web/src/features/user-settings/ui/panels` (Skill 관리 패널)

## 인접 도메인: Wiki Schema

스킬 화면은 `wiki-schema/**`를 호출하지 않는다. 앱 어디에서도 렌더링되지 않던
`localStorage` 목업(`web/src/entities/schema`, `web/src/features/schema-manage`)은 제거했다.
document-svc의 `wiki-schema/**` 4개 경로는 미호출이다. [uncalled.md](../uncalled.md) 참조.
