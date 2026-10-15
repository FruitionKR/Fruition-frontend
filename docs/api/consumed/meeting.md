# 회의 받아쓰기 소비 API

[API 배선 문서](../README.md) / [소비 API](README.md)

document-svc의 회의 실시간 받아쓰기와 회의록 초안 API다(#148, 계약은 Fruition-document `docs/api/meetings.md`).
화면은 채팅 패널의 회의록 화면(Figma `1540:22903`)이고, 입력창 파형 버튼 메뉴의 "회의 받아쓰기"로 시작한다.
`meetings/**`는 직접 전송 정규식에 **없어서** REST는 rewrite를 경유한다. WebSocket만 문서 API 오리진에 직접 붙는다.

- 호출 지점: 8 (REST 7 + WebSocket 1)
- 호출 경로: 7 + WebSocket 1

## 회의와 실시간 받아쓰기

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/meetings` | 실시간 받아쓰기 회의 생성 | `web/src/entities/meeting/api/meetings.ts` `createMeeting` | `workspacePath(getWorkspaceId(), "meetings")` | `Idempotency-Key`, `{ source: "live", document_id? }` | `meeting_id`, `document_id` | 편집 중인 Markdown 문서가 있으면(`markdownEditContext.documentId`) `document_id`로 보내 회의록을 그 문서 끝에 추가할 수 있게 한다. 마이크 권한을 먼저 받은 뒤 만든다 |
| `POST /api/workspaces/{workspace_id}/meetings/{meeting_id}/live-tickets` | WebSocket용 60초 일회용 ticket | `web/src/entities/meeting/api/meetings.ts` `issueMeetingLiveTicket` | `workspacePath(getWorkspaceId(), "meetings", meetingId, "live-tickets")` | 없음 | `ticket` | 연결·재연결마다 새로 받는다. `409 MEETING_LIVE_IN_USE`는 다시 시도하지 않고 서버 문구로 끝낸다 |
| `WS /api/meetings/{meeting_id}/live?ticket=` | 오디오 전송·전사 이벤트 수신 | `web/src/features/meeting-dictation/model/liveSession.ts` `createLiveSession`, `useMeetingSession.ts` `openLiveSocket` | `buildLiveSocketUrl(transport.origin, location.origin, …)` (`lib/liveProtocol.ts`) | 바이너리 PCM16 LE mono 24kHz(frame ≤ 48,000 bytes), `{"type":"commit"}`(2초 이후 쉼 또는 15초마다), `{"type":"finish"}` | `ready`, `committed`, `delta`, `completed`, `finished`, `error.code`, close `4409` | `getDocumentTransport().origin`(BACKEND_URL)이 있으면 그 오리진의 `ws(s)`로, 없으면 화면 오리진으로 붙는다(로컬은 Next rewrite가 upgrade를 중계한다). CSP `connect-src`에 BACKEND_URL의 ws(s) 오리진을 넣었다. `ready` 전 음성은 모아 두었다가(최대 30초) 보낸다. 끊기면 새 ticket으로 최대 3번 다시 붙고, 55분이 되면 `finish` 뒤 새 연결로 넘긴다. `insufficient_credit`·`transcript_limit`(10만 자)·`meeting_not_open`·4409는 다시 붙지 않고 안내한다. 마이크는 `getUserMedia` + `ScriptProcessor`(`model/microphoneCapture.ts`)로 받아 24kHz로 줄인다 |

## 회의록 초안과 저장

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/meetings/{meeting_id}/notes` | 확정 전사로 초안 생성(비동기) | `web/src/entities/meeting/api/meetings.ts` `requestMeetingNotes` | `workspacePath(…, "meetings", meetingId, "notes")` + `?allow_partial=true`(선택) | `Idempotency-Key`(같은 요청의 재시도는 같은 키) | `status`, `version`, `error_code` | 받아쓰기가 `finished`로 끝나면 자동으로 요청한다. `409 MEETING_LIVE_IN_USE`는 1.5초 간격 3번까지 다시 보낸다. `409 MEETING_TRANSCRIPT_INCOMPLETE`면 "저장된 내용으로 회의록 만들기"(`allow_partial`)를 보여 준다. `422 MEETING_TRANSCRIPT_EMPTY`·`409 MEETING_NOTES_BUSY`는 안내만 한다 |
| `GET /api/workspaces/{workspace_id}/meetings/{meeting_id}/notes` | 최신 초안 조회 | `web/src/entities/meeting/api/meetings.ts` `fetchMeetingNotes` | `workspacePath(…, "notes")` | `cache: no-store` | `status`, `markdown`, `version`, `error_code`, `applied` | `generating` 동안 2초마다 조회한다. `failed`는 `describeMeetingNotesError`(`web/src/shared/lib/aiErrorCodes.ts`)로 안내한다(`INSUFFICIENT_CREDIT` 포함) |
| `POST /api/workspaces/{workspace_id}/meetings/{meeting_id}/notes/cancel` | 만드는 초안 취소 | `web/src/entities/meeting/api/meetings.ts` `cancelMeetingNotes` | `workspacePath(…, "notes", "cancel")` | 없음 | `status` | "회의록 만들기 취소" 버튼 |
| `POST /api/workspaces/{workspace_id}/meetings/{meeting_id}/notes/{version}/append-preview` | 회의를 시작한 문서 끝에 붙인 결과 미리보기 | `web/src/entities/meeting/api/meetings.ts` `previewMeetingNotesAppend` | `workspacePath(…, "notes", version, "append-preview")` | `{}` | `document_id`, `base_revision`, `markdown` | 회의에 `document_id`가 있을 때만 "문서 끝에 추가" 버튼이 보인다. 결과 본문을 카드에 그대로 보여 준다 |
| `POST /api/workspaces/{workspace_id}/meetings/{meeting_id}/notes/{version}/apply` | 새 문서로 저장 또는 문서 끝에 추가 | `web/src/entities/meeting/api/meetings.ts` `applyMeetingNotes` | `workspacePath(…, "notes", version, "apply")` | `Idempotency-Key`, `{ mode: "create" }` 또는 `{ mode: "append", document_id, base_revision }` | `applied.document_id` | 저장 뒤 `usePendingDocumentOpen.openSavedDocument`가 문서 목록을 새로 받고 그 문서를 연다. `409 DOCUMENT_REVISION_CHANGED`·`MEETING_NOTES_OUTDATED`·`MEETING_NOTES_ALREADY_APPLIED`는 `describeNotesSaveError` 문구 |

## UI 위치

- 회의록 화면: `web/src/features/meeting-dictation/ui/MeetingNotesView.tsx` (`web/src/widgets/agent-panel/ui/AgentPanel.tsx`가 채팅 대화 자리에 띄운다)
- 시작·멈춤: `web/src/features/agent-chat/ui/AgentComposer.tsx` 파형 버튼(메뉴: 음성으로 입력 · 회의 받아쓰기)

## 호출하지 않는 회의 경로

녹음 파일 업로드 전사는 시안이 없어 이번 화면에 넣지 않았다.
`recording/uploads`(+`/parts`·`/complete`·`/abort`), `transcription/cancel`, `recording-url`,
`GET meetings/{meeting_id}`, `DELETE meetings/{meeting_id}`. [uncalled.md](../uncalled.md) 참조.
