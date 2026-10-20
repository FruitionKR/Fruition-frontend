# AI·Agent·Query 소비 API

[API 배선 문서](../README.md) / [소비 API](README.md)

document-svc의 AI 모델 설정, 채팅 세션, 비동기 Query, Markdown Agent, AI 작업 로그, 채팅 음성 입력·답변 듣기다.
`agent/**`과 `chat/**`은 직접 전송 정규식에 포함되고, `ai-models`·`ai-model-settings`·
`ai-operation-logs`·`ai/tasks`·`query/runs`·`speech`·`usage`는 포함되지 않아 rewrite를 경유한다.

- 호출 지점: 21
- 호출 경로: 19

## 음성 입력·답변 듣기

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/speech/transcriptions` | 채팅 입력창 마이크 녹음을 텍스트로 전사 | `web/src/features/agent-chat/api/speech.ts` `transcribeSpeech` | `workspacePath(getWorkspaceId(), "speech", "transcriptions")` | 오디오 `Blob` bytes 그대로(multipart 아님). `Content-Type`은 `MediaRecorder`가 고른 `audio/webm;codecs=opus`·`audio/webm`·`audio/mp4`·`audio/mpeg`·`audio/wav` | `text` | `web/src/features/agent-chat/model/useDictation.ts`가 `MediaRecorder`로 녹음하고 60초에 자동 종료한다. 24 MiB 초과는 요청 전에 막는다. `text`가 빈 문자열(무음)이면 "인식된 음성이 없습니다"만 안내한다. 결과는 입력창에 채우기만 하고 자동 전송하지 않는다. 실패 문구는 `parseApiError`가 서버 `error.message`(402 포함)를 그대로 쓴다 |
| `POST /api/workspaces/{workspace_id}/speech/synthesis` | 완료된 assistant 답변을 음성으로 스트리밍(#149) | `web/src/features/agent-chat/api/speech.ts` `streamSpeechSynthesis` | `workspacePath(getWorkspaceId(), "speech", "synthesis")` | `{ message_id }` JSON, `cache: no-store`, `AbortSignal` | `application/x-ndjson` 이벤트 스트림: `audio.delta`(base64 PCM16 LE mono 24kHz), `done`, `error.code` | `web/src/features/agent-chat/model/useSpeechPlayback.ts`가 한 번에 하나만 재생한다. `lib/speechPlayback.ts`가 줄 단위 JSON을 파싱하고 조각 경계의 남는 1바이트를 다음 조각 앞에 붙여 `AudioContext` 버퍼로 이어 재생한다. 멈춤·다른 답변 재생·세션 전환·언마운트는 `AbortController`로 요청을 끊어 서버 합성을 멈춘다. 스트림 시작 전 오류(400·402·404·409·422)는 `parseApiError` 문구(402는 크레딧 부족 안내), 스트림 `error.code`는 `describeTtsStreamError`, 연결 실패는 재시도 안내다. 다시 들으면 서버가 30일 저장본을 같은 형식으로 보낸다 |

## 모델 설정

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/ai-models` | 선택 가능한 provider/model 카탈로그 | `web/src/entities/ai/api/aiModels.ts` `fetchAiModels` | 리터럴 | `cache: no-store` | `models[]` | 워크스페이스 비종속 전역 경로 |
| `GET /api/workspaces/{workspace_id}/ai-model-settings` | ingest·lint용 워크스페이스 모델 설정 조회 | `web/src/entities/ai/api/aiModels.ts` `fetchWorkspaceAiModelSettings` | `workspacePath(workspaceId, "ai-model-settings")` | `cache: no-store` | `WorkspaceAiModelSettings` | - |
| `PUT /api/workspaces/{workspace_id}/ai-model-settings` | 모델 설정 저장 | `web/src/entities/ai/api/aiModels.ts` `updateWorkspaceAiModelSettings` | `workspacePath(workspaceId, "ai-model-settings")` | `{ ingest_lint: { provider, model } }` | `WorkspaceAiModelSettings` | `provider`·`model`은 backend 카탈로그 검증 대상이라 쌍으로 보낸다 |

## AI 사용량

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/usage/models` | 지금 워크스페이스에서 내가 쓴 모델별 토큰(사용자 설정 맨 아래 AI 사용량) | `web/src/entities/ai/api/aiUsage.ts` `fetchModelUsage` | `workspacePath(workspaceId, "usage", "models")` + `?from_at&to_at` | `from_at`·`to_at` ISO 8601 UTC(`toISOString`), `cache: no-store`. 기간은 기기 시간대 기준 이번 달(1일~지금)·지난 30일·지난 달 | `models[]`의 `provider`, `requested_model`, `model`, `known_input_tokens`, `known_output_tokens`, `known_cached_input_tokens`, `unknown_usage_calls` | `web/src/features/user-settings/ui/panels/AiUsageSection.tsx`가 react-query(`["aiUsage", workspaceId, period]`, 폴링 없음)로 부른다. `entities/ai/model/aiUsage.ts` `summarizeModelUsage`가 같은 요청 모델의 스냅샷 줄을 합치고 이름은 `ai-models` 카탈로그·`LOCKED_AI_MODELS`의 `display_name`을 쓴다. 합계는 입력+출력이며 캐시(입력의 부분 집합)·추론(출력의 부분 집합)은 더하지 않는다. 404(비멤버·경로 없음)는 중립 안내만, 그 밖의 오류는 다시 시도 버튼. 크레딧(`users/me/credits`)은 결제 보류로 부르지 않는다([uncalled.md](../uncalled.md)) |
| `GET /api/users/me/usage/charges` | AI 사용량 합계 카드·모델 줄의 예상 비용(읽기 전용) | `web/src/entities/ai/api/aiUsage.ts` `fetchUsageCharges` | 리터럴 `/api/users/me/usage/charges` + `?from_at&to_at` | `usage/models`와 같은 `from_at`·`to_at`(사용량 응답의 range를 그대로 씀), `cache: no-store` | `charge_krw_milli`, `models[]`의 `provider`, `model`, `calls`, `input_tokens`, `output_tokens`, `charge_krw_milli`, `unpriced_calls` | 응답은 모든 워크스페이스를 합친 응답 모델별 실제 청구(부가세 포함 milli-KRW)라 워크스페이스로 거를 수 없다. `estimateUsageCost`가 모델별 평균 단가(청구 금액 ÷ 청구 입력+출력 토큰)를 이 워크스페이스 `usage/models` 줄(같은 `provider`+응답 `model`)의 토큰에 곱해 예상 비용을 만든다. 모든 호출이 `unpriced`인 모델·아직 청구가 집계되지 않은 모델은 금액 없음으로 두고 안내한다. 토큰 없이 음성 초·TTS 글자로 매긴 금액은 워크스페이스에 나눌 수 없어 "모든 워크스페이스 합산 청구"(`charge_krw_milli`, 예상과 원 단위로 다를 때만)에만 들어간다. 표시는 원 단위 반올림, 0원 초과 1원 미만은 `<₩1`. react-query `["aiUsageCharges", from, to]`, `retry: false`. 실패(404 포함)해도 토큰 화면은 그대로 두고 "비용을 불러오지 못했어요" 안내만 보인다 |

## 채팅 세션

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/chat/sessions` | 세션 목록 | `web/src/entities/chat/api/chat.ts` `fetchChatSessions`, `resolveSessionId` | `workspacePath(workspaceId, "chat", "sessions")` | `cache: no-store` | `sessions[]`, `sessions[0].id` | `resolveSessionId`는 목록의 첫 항목(최신)을 쓰고, 없으면 바로 생성으로 넘어간다 |
| `POST /api/workspaces/{workspace_id}/chat/sessions` | 세션 생성 | `web/src/entities/chat/api/chat.ts` `createChatSession`, `resolveSessionId` | `workspacePath(workspaceId, "chat", "sessions")` | `{ title }` 또는 `{}` | `ChatSessionResponse.id` | 두 호출 지점이 같은 경로를 쓴다 |
| `DELETE /api/workspaces/{workspace_id}/chat/sessions/{session_id}` | 세션 삭제 | `web/src/entities/chat/api/chat.ts` `deleteChatSession` | `workspacePath(workspaceId, "chat", "sessions", sessionId)` | 본문 없음 | - (`throwIfNotOk`) | 삭제한 세션이 활성이면 모듈 내 세션 캐시도 비운다 |
| `GET /api/workspaces/{workspace_id}/chat/sessions/{session_id}/messages` | 세션 메시지 조회 | `web/src/entities/chat/api/chat.ts` `fetchChatMessages` | `workspacePath(workspaceId, "chat", "sessions", sessionId, "messages")` | `cache: no-store` | `ChatMessagesResponse` | - |

세션 ID 확보는 `getSessionContext()`가 담당한다. 모듈 내 캐시 → 목록 조회 → 생성 순서이며
Query와 Wiki 내보내기가 이 컨텍스트를 공유한다.

## 비동기 Query

이 저장소는 동기 Query(`chat/sessions/{session_id}/query`)를 **쓰지 않고** 비동기 run + SSE
조합을 쓴다. 의도적 선택이며 근거는 [uncalled.md](../uncalled.md#의도적-비사용)에 적었다.

흐름(`web/src/entities/wiki/api/wiki.ts` `runQueryStream`): run 생성 → SSE 구독 → 상태 조회.

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/chat/sessions/{session_id}/query/runs` | 질의를 비동기 run으로 시작 | `web/src/entities/wiki/api/wiki.ts` `runQueryStream` | `workspacePath(workspaceId, "chat", "sessions", sessionId, "query", "runs")` | `{ question, provider, model, allow_web_search }` | `request_id`, `status` | `allow_web_search`는 backend `@NotNull`이라 항상 명시한다(기본 `false`). `provider`·`model`은 쌍으로 보낸다 |
| `GET /api/query/runs/{requestId}/events` | run 진행 단계 SSE | `web/src/entities/wiki/api/wiki.ts` `runQueryStream` | 템플릿 결합 (`` `/api/query/runs/${encodeURIComponent(requestId)}/events` ``) | `Accept: text/event-stream`, `cache: no-store` | 이벤트 스트림 → `readRunEvents` | `EventSource`가 Bearer를 못 붙여 `apiFetch` 응답 본문 스트림을 직접 읽는다. 워크스페이스 하위가 아닌 전역 경로다 |
| `GET /api/query/runs/{requestId}` | run 최종 상태·결과 | `web/src/entities/wiki/api/wiki.ts` `runQueryStream` | 템플릿 결합 (`encodeURIComponent(requestId)`) | `cache: no-store` | `status`, `result` | SSE 종료 후 결과를 확정한다. `status === "cancelled"`면 `QueryCancelledError` |
| `POST /api/workspaces/{workspace_id}/ai/tasks/{id}/cancel` | 진행 중 질의 취소 요청 | `web/src/entities/wiki/api/wiki.ts` `cancelQueryRun` | 템플릿 결합 (`` `${workspacePath(run.workspaceId, "ai", "tasks", run.requestId)}/cancel` ``) | 본문 없음 | `status`, `error_code` | 취소 요청의 응답 자체도 상태 객체로 읽는다 |
| `GET /api/workspaces/{workspace_id}/ai/tasks/{id}` | 취소 완료까지 상태 폴링 | `web/src/entities/wiki/api/wiki.ts` `cancelQueryRun` | `workspacePath(run.workspaceId, "ai", "tasks", run.requestId)` | `cache: no-store` | `status`, `error_code` | 1초 간격 폴링. `cancelled`면 종료, `rollback_failed`면 재시도를 안내하는 오류를 던진다. query run id를 AI task id로 그대로 쓴다 |

## Markdown Agent

흐름(`web/src/features/agent-chat/api/agent.ts` `requestAgentTurn`): turn 생성 → (이미 종료 상태면
바로 반환) → SSE 구독 → 상태 조회. 전체 타임아웃 300초(`AbortSignal.timeout`).

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/agent/turn` | Agent turn 시작 | `web/src/features/agent-chat/api/agent.ts` `requestAgentTurn` | `workspacePath(workspaceId, "agent", "turn")` | `AgentTurnRequest` JSON. 폴더를 대상으로 고른 스킬 실행이면 `folder_id`(폴더 UUID)를 싣고 요청 문장은 `/slug`만 보낸다. 폴더가 없으면 키를 싣지 않는다 | `status`, `result`, `requestId` | 생성 응답이 이미 종료 상태면 SSE를 열지 않고 즉시 반환한다. `folder_id`가 UUID가 아니면 `400`, 살아 있는 폴더가 아니면 `404` |
| `GET /api/workspaces/{workspace_id}/agent/turn/{run_id}/events` | turn 진행 단계 SSE | `web/src/features/agent-chat/api/agent.ts` `requestAgentTurn` | 템플릿 결합 (`` `${workspacePath(workspaceId, "agent", "turn", run.requestId)}/events` ``) | `Accept: text/event-stream`, `cache: no-store` | 이벤트 스트림 → `readRunEvents` | `cancelled` 종료면 "요청이 취소되었습니다." |
| `GET /api/workspaces/{workspace_id}/agent/turn/{run_id}` | turn 최종 상태 | `web/src/features/agent-chat/api/agent.ts` `requestAgentTurn` · `checkAgentTurnStatus` / `web/src/features/agent-chat/api/agentPlan.ts` `fetchAgentPlanRun` | `workspacePath(workspaceId, "agent", "turn", run.requestId \| turnId)` | `cache: no-store` | `status`, `result.run_id`, `error`, `folder_id` | `markdown_create` 초안은 응답의 `folder_id` 폴더에 새 문서로 올리고, `null`이면 루트에 둔다(`resolveGeneratedDocumentFolderId`). 계획 패널은 turn의 `result.run_id`를 얻어 승인 대상 run으로 넘어간다. turn ID와 run ID는 서로 다르다. `checkAgentTurnStatus`는 10분 넘게 pending인 turn(또는 막힌 스킬 실행 앞의 turn)을 확인해, 404거나 오래 끝나지 않으면 '응답을 받지 못했어요'로 표시한다. agent turn 취소 API가 없어 '닫기'는 화면의 입력 잠금만 푼다 |
| `GET /api/workspaces/{workspace_id}/agent/runs/{run_id}` | 실행 계획 조회 | `web/src/features/agent-chat/api/agentPlan.ts` `fetchAgentPlanRun` | `workspacePath(workspaceId, "agent", "runs", turn.result.run_id)` | `cache: no-store` | `AgentPlanRun` 전체 | 폴더 정리 미리보기는 `target_folder_id`(제목 폴더, 없으면 옮겨지는 항목이 가장 많던 원래 폴더), `rule_summary`(규칙 문구, 없으면 사용자 요청), `plan.operations[].warning`(`duplicate_name`은 빨간 줄·사유, `depends_on_unselected`는 보조 안내)·`suggested_selected`(기본 선택: 줄의 작업이 모두 `!== false`일 때만), 승인 뒤 `status: "skipped"` + `error_code: "not_selected"`(제외됨 표시)를 쓴다 |
| `POST /api/workspaces/{workspace_id}/agent/runs/{run_id}/approve` | 계획 승인 | `web/src/features/agent-chat/api/agentPlan.ts` `decideAgentPlan` (`decision === "approve"`) | 템플릿 결합 — `workspacePath(workspaceId, "agent", "runs", runId, decision)`, `decision`이 마지막 segment | `{ plan_version, operation_hash, operation_ids? }` | `AgentPlanRun` | `idempotentJsonHeaders()`. 폴더 정리 미리보기에서 일부 줄만 고르면 `operation_ids`(1–20개)에 고른 줄의 모든 작업(이동·이름 변경 등)과 그 작업이 기대는 작업(`depends_on`·`$operation_result` 새 폴더)을 계획 순서로 보낸다. 모든 줄을 고르면 생략(계획 전체). 0개면 버튼을 막고, 부분 선택이 20개를 넘으면 적용을 막는다. `operation_ids`를 보낸 요청의 `400`(중복·계획에 없는 ID·고르지 않은 작업에 의존)은 선택 오류 문구로 보여 준다. 작업 탭 카드의 수락은 계획 전체 승인이다. 경로의 마지막 segment가 변수라 리터럴 검색으로 찾히지 않는다 |
| `POST /api/workspaces/{workspace_id}/agent/runs/{run_id}/reject` | 계획 거절 | `web/src/features/agent-chat/api/agentPlan.ts` `decideAgentPlan` (`decision === "reject"`) | 위와 같은 호출, `decision === "reject"` | 본문 없음 | `AgentPlanRun` | `idempotentJsonHeaders()`. `decision` 유니온은 `"approve" \| "reject"`로만 선언되어 있어 `cancel`·`revise`는 호출될 수 없다 |

작업 탭 입력에서 열린 문서 문맥(`documentId`·`baseVersion`·`editorSnapshot` → AI의 `document_id`·`base_version`·
`active_markdown_context`)을 실을지는 입력의 `/slug`가 가리키는 스킬로 정한다
(`web/src/widgets/agent-panel/lib/openDocumentSource.ts` `shouldSendOpenDocument`). AI는 명시한 '새 문서로 만들기' 스킬에
`active_markdown_context`가 오면 그 문서를 원문(`source_document`)으로 쓰므로, 무관한 열린 문서가 원문이 되지 않게 프론트가 뺀다.

| 입력 | 열린 문서 |
|---|---|
| 일반 요청(스킬 없음) · `/열린 문서 고치기` · `/상황에 맞게` · 템플릿 · 폴더 정리 | 싣는다("현재 문서" 칩 ×로 뺄 수 있음) |
| `/새 문서로 만들기` 스킬 | 기본으로 뺀다. 칩이 점선 "현재 문서"로 바뀌고, 누르면 "현재 문서 · 원문으로 사용"이 되어 싣는다. 보내면 다시 뺀 상태로 돌아간다 |
| `@문서` 멘션 | 멘션한 문서만 원문(열린 문서는 싣지 않음). 멘션 고르기 UI는 아직 없다 |

문서를 빼고 보낸 '새 문서로 만들기' 요청의 새 문서 위치는 기존대로 `folder_id` 없이(루트) 둔다. 스킬 화면에서 사이드바로 문서를 골라
실행하는 경로는 이 규칙과 무관하게 고른 문서를 싣는다([skill.md](skill.md) "스킬 화면에서 실행").

계획 패널은 문서·폴더 이름 표시를 위해 `document-tree`도 조회한다
(`fetchPlanTree`, [document.md](document.md) 참조).

## AI 작업 로그

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/workspaces/{workspace_id}/ai-operation-logs` | 작업 로그 목록 | `web/src/entities/operation-log/api/operationLog.ts` `fetchOperationLogs` | 템플릿 결합 (`` `${workspacePath(getWorkspaceId(), "ai-operation-logs")}${buildOperationLogQuery(query)}` ``) | query `cursor`, `type`, `status`, `size` (`URLSearchParams`, `web/src/entities/operation-log/model/operationLogQuery.ts`) | `OperationLogListResponse` | 이 저장소에서 cursor 페이지네이션과 필터링을 쓰는 유일한 경로다 |
| `GET /api/workspaces/{workspace_id}/ai-operation-logs/{operation_id}` | 로그 상세 | `web/src/entities/operation-log/api/operationLog.ts` `fetchOperationLogDetail` | `workspacePath(getWorkspaceId(), "ai-operation-logs", operationId)` | - (`cache` 지정 없음) | `OperationLogDetail` | ingest·lint는 Wiki 제목·유형, 그 외는 변경분을 담는다 |
| `GET /api/workspaces/{workspace_id}/ai-operation-logs/{operation_id}/restore-preview` | 롤백 계획과 서명 토큰 | `web/src/entities/operation-log/api/operationLog.ts` `fetchRestorePreview` | `workspacePath(getWorkspaceId(), "ai-operation-logs", operationId, "restore-preview")` | - | `RestorePreviewResponse.preview_token` | 실행 전 반드시 선행한다 |
| `POST /api/workspaces/{workspace_id}/ai-operation-logs/{operation_id}/restore` | 롤백 실행 | `web/src/entities/operation-log/api/operationLog.ts` `restoreOperation` | `workspacePath(getWorkspaceId(), "ai-operation-logs", operationId, "restore")` | `{ preview_token }` | `RestoreExecuteResponse` | 미리보기에서 받은 토큰이 필수 |

## UI 위치

- 채팅·질의 입력·계획 승인: `web/src/features/agent-chat/ui`, `web/src/widgets/agent-panel/ui`
- 모델 설정: `web/src/features/settings/ui`
- 작업 로그 뷰: `web/src/widgets/log-view/ui`
