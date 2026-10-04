# AI·Agent·Query 소비 API

[API 배선 문서](../README.md) / [소비 API](README.md)

document-svc의 AI 모델 설정, 채팅 세션, 비동기 Query, Markdown Agent, AI 작업 로그다.
`agent/**`과 `chat/**`은 직접 전송 정규식에 포함되고, `ai-models`·`ai-model-settings`·
`ai-operation-logs`·`ai/tasks`·`query/runs`는 포함되지 않아 rewrite를 경유한다.

- 호출 지점: 18
- 호출 경로: 16

## 모델 설정

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/ai-models` | 선택 가능한 provider/model 카탈로그 | `src/entities/ai/api/aiModels.ts` `fetchAiModels` | 리터럴 | `cache: no-store` | `models[]` | 워크스페이스 비종속 전역 경로 |
| `GET /api/workspaces/{workspace_id}/ai-model-settings` | ingest·lint용 워크스페이스 모델 설정 조회 | `src/entities/ai/api/aiModels.ts` `fetchWorkspaceAiModelSettings` | `workspacePath(workspaceId, "ai-model-settings")` | `cache: no-store` | `WorkspaceAiModelSettings` | - |
| `PUT /api/workspaces/{workspace_id}/ai-model-settings` | 모델 설정 저장 | `src/entities/ai/api/aiModels.ts` `updateWorkspaceAiModelSettings` | `workspacePath(workspaceId, "ai-model-settings")` | `{ ingest_lint: { provider, model } }` | `WorkspaceAiModelSettings` | `provider`·`model`은 backend 카탈로그 검증 대상이라 쌍으로 보낸다 |

## 채팅 세션

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/chat/sessions` | 세션 목록 | `src/entities/chat/api/chat.ts` `fetchChatSessions`, `resolveSessionId` | `workspacePath(workspaceId, "chat", "sessions")` | `cache: no-store` | `sessions[]`, `sessions[0].id` | `resolveSessionId`는 목록의 첫 항목(최신)을 쓰고, 없으면 바로 생성으로 넘어간다 |
| `POST /api/workspaces/{workspace_id}/chat/sessions` | 세션 생성 | `src/entities/chat/api/chat.ts` `createChatSession`, `resolveSessionId` | `workspacePath(workspaceId, "chat", "sessions")` | `{ title }` 또는 `{}` | `ChatSessionResponse.id` | 두 호출 지점이 같은 경로를 쓴다 |
| `DELETE /api/workspaces/{workspace_id}/chat/sessions/{session_id}` | 세션 삭제 | `src/entities/chat/api/chat.ts` `deleteChatSession` | `workspacePath(workspaceId, "chat", "sessions", sessionId)` | 본문 없음 | - (`throwIfNotOk`) | 삭제한 세션이 활성이면 모듈 내 세션 캐시도 비운다 |
| `GET /api/workspaces/{workspace_id}/chat/sessions/{session_id}/messages` | 세션 메시지 조회 | `src/entities/chat/api/chat.ts` `fetchChatMessages` | `workspacePath(workspaceId, "chat", "sessions", sessionId, "messages")` | `cache: no-store` | `ChatMessagesResponse` | - |

세션 ID 확보는 `getSessionContext()`가 담당한다. 모듈 내 캐시 → 목록 조회 → 생성 순서이며
Query와 Wiki 내보내기가 이 컨텍스트를 공유한다.

## 비동기 Query

이 저장소는 동기 Query(`chat/sessions/{session_id}/query`)를 **쓰지 않고** 비동기 run + SSE
조합을 쓴다. 의도적 선택이며 근거는 [uncalled.md](../uncalled.md#의도적-비사용)에 적었다.

흐름(`src/entities/wiki/api/wiki.ts` `runQueryStream`): run 생성 → SSE 구독 → 상태 조회.

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/chat/sessions/{session_id}/query/runs` | 질의를 비동기 run으로 시작 | `src/entities/wiki/api/wiki.ts` `runQueryStream` | `workspacePath(workspaceId, "chat", "sessions", sessionId, "query", "runs")` | `{ question, provider, model, allow_web_search }` | `request_id`, `status` | `allow_web_search`는 backend `@NotNull`이라 항상 명시한다(기본 `false`). `provider`·`model`은 쌍으로 보낸다 |
| `GET /api/query/runs/{requestId}/events` | run 진행 단계 SSE | `src/entities/wiki/api/wiki.ts` `runQueryStream` | 템플릿 결합 (`` `/api/query/runs/${encodeURIComponent(requestId)}/events` ``) | `Accept: text/event-stream`, `cache: no-store` | 이벤트 스트림 → `readRunEvents` | `EventSource`가 Bearer를 못 붙여 `apiFetch` 응답 본문 스트림을 직접 읽는다. 워크스페이스 하위가 아닌 전역 경로다 |
| `GET /api/query/runs/{requestId}` | run 최종 상태·결과 | `src/entities/wiki/api/wiki.ts` `runQueryStream` | 템플릿 결합 (`encodeURIComponent(requestId)`) | `cache: no-store` | `status`, `result` | SSE 종료 후 결과를 확정한다. `status === "cancelled"`면 `QueryCancelledError` |
| `POST /api/workspaces/{workspace_id}/ai/tasks/{id}/cancel` | 진행 중 질의 취소 요청 | `src/entities/wiki/api/wiki.ts` `cancelQueryRun` | 템플릿 결합 (`` `${workspacePath(run.workspaceId, "ai", "tasks", run.requestId)}/cancel` ``) | 본문 없음 | `status`, `error_code` | 취소 요청의 응답 자체도 상태 객체로 읽는다 |
| `GET /api/workspaces/{workspace_id}/ai/tasks/{id}` | 취소 완료까지 상태 폴링 | `src/entities/wiki/api/wiki.ts` `cancelQueryRun` | `workspacePath(run.workspaceId, "ai", "tasks", run.requestId)` | `cache: no-store` | `status`, `error_code` | 1초 간격 폴링. `cancelled`면 종료, `rollback_failed`면 재시도를 안내하는 오류를 던진다. query run id를 AI task id로 그대로 쓴다 |

## Markdown Agent

흐름(`src/features/agent-chat/api/agent.ts` `requestAgentTurn`): turn 생성 → (이미 종료 상태면
바로 반환) → SSE 구독 → 상태 조회. 전체 타임아웃 300초(`AbortSignal.timeout`).

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/agent/turn` | Agent turn 시작 | `src/features/agent-chat/api/agent.ts` `requestAgentTurn` | `workspacePath(workspaceId, "agent", "turn")` | `AgentTurnRequest` JSON | `status`, `result`, `requestId` | 생성 응답이 이미 종료 상태면 SSE를 열지 않고 즉시 반환한다 |
| `GET /api/workspaces/{workspace_id}/agent/turn/{run_id}/events` | turn 진행 단계 SSE | `src/features/agent-chat/api/agent.ts` `requestAgentTurn` | 템플릿 결합 (`` `${workspacePath(workspaceId, "agent", "turn", run.requestId)}/events` ``) | `Accept: text/event-stream`, `cache: no-store` | 이벤트 스트림 → `readRunEvents` | `cancelled` 종료면 "요청이 취소되었습니다." |
| `GET /api/workspaces/{workspace_id}/agent/turn/{run_id}` | turn 최종 상태 | `src/features/agent-chat/api/agent.ts` `requestAgentTurn` / `src/features/agent-chat/api/agentPlan.ts` `fetchAgentPlanRun` | `workspacePath(workspaceId, "agent", "turn", run.requestId \| turnId)` | `cache: no-store` | `status`, `result.run_id`, `error` | 계획 패널은 turn의 `result.run_id`를 얻어 승인 대상 run으로 넘어간다. turn ID와 run ID는 서로 다르다 |
| `GET /api/workspaces/{workspace_id}/agent/runs/{run_id}` | 실행 계획 조회 | `src/features/agent-chat/api/agentPlan.ts` `fetchAgentPlanRun` | `workspacePath(workspaceId, "agent", "runs", turn.result.run_id)` | `cache: no-store` | `AgentPlanRun` 전체 | - |
| `POST /api/workspaces/{workspace_id}/agent/runs/{run_id}/approve` | 계획 승인 | `src/features/agent-chat/api/agentPlan.ts` `decideAgentPlan` (`decision === "approve"`) | 템플릿 결합 — `workspacePath(workspaceId, "agent", "runs", runId, decision)`, `decision`이 마지막 segment | `{ plan_version, operation_hash }` | `AgentPlanRun` | `idempotentJsonHeaders()`. 경로의 마지막 segment가 변수라 리터럴 검색으로 찾히지 않는다 |
| `POST /api/workspaces/{workspace_id}/agent/runs/{run_id}/reject` | 계획 거절 | `src/features/agent-chat/api/agentPlan.ts` `decideAgentPlan` (`decision === "reject"`) | 위와 같은 호출, `decision === "reject"` | 본문 없음 | `AgentPlanRun` | `idempotentJsonHeaders()`. `decision` 유니온은 `"approve" \| "reject"`로만 선언되어 있어 `cancel`·`revise`는 호출될 수 없다 |

계획 패널은 문서·폴더 이름 표시를 위해 `document-tree`도 조회한다
(`fetchPlanTree`, [document.md](document.md) 참조).

## AI 작업 로그

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/ai-operation-logs` | 작업 로그 목록 | `src/entities/operation-log/api/operationLog.ts` `fetchOperationLogs` | 템플릿 결합 (`` `${workspacePath(getWorkspaceId(), "ai-operation-logs")}${buildOperationLogQuery(query)}` ``) | query `cursor`, `type`, `status`, `size` (`URLSearchParams`, `src/entities/operation-log/model/operationLogQuery.ts`) | `OperationLogListResponse` | 이 저장소에서 cursor 페이지네이션과 필터링을 쓰는 유일한 경로다 |
| `GET /api/workspaces/{workspace_id}/ai-operation-logs/{operation_id}` | 로그 상세 | `src/entities/operation-log/api/operationLog.ts` `fetchOperationLogDetail` | `workspacePath(getWorkspaceId(), "ai-operation-logs", operationId)` | - (`cache` 지정 없음) | `OperationLogDetail` | ingest·lint는 Wiki 제목·유형, 그 외는 변경분을 담는다 |
| `GET /api/workspaces/{workspace_id}/ai-operation-logs/{operation_id}/restore-preview` | 롤백 계획과 서명 토큰 | `src/entities/operation-log/api/operationLog.ts` `fetchRestorePreview` | `workspacePath(getWorkspaceId(), "ai-operation-logs", operationId, "restore-preview")` | - | `RestorePreviewResponse.preview_token` | 실행 전 반드시 선행한다 |
| `POST /api/workspaces/{workspace_id}/ai-operation-logs/{operation_id}/restore` | 롤백 실행 | `src/entities/operation-log/api/operationLog.ts` `restoreOperation` | `workspacePath(getWorkspaceId(), "ai-operation-logs", operationId, "restore")` | `{ preview_token }` | `RestoreExecuteResponse` | 미리보기에서 받은 토큰이 필수 |

## UI 위치

- 채팅·질의 입력·계획 승인: `src/features/agent-chat/ui`, `src/widgets/agent-panel/ui`
- 모델 설정: `src/features/settings/ui`
- 작업 로그 뷰: `src/widgets/log-view/ui`
