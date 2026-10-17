# 회의 받아쓰기 소비 API

[API 배선 문서](../README.md) / [소비 API](README.md)

document-svc의 회의 실시간 받아쓰기·녹음 파일 전사·녹음 재생·회의 삭제와 회의록 초안 API다(#148, 계약은 Fruition-document `docs/api/meetings.md`).
화면은 채팅 패널의 회의록 화면(Figma `1540:22903`)이고, 입력창 파형 버튼 메뉴의 "회의 받아쓰기"·"녹음 파일로 전사"로 시작하고, "지난 회의"로 만든 회의를 다시 연다.
녹음 파일 전사·재생·삭제·지난 회의 목록은 시안이 없어 같은 화면의 글자 버튼·진행 표시·확인 모달 패턴을 따른다.
`meetings/**`는 직접 전송 정규식에 **없어서** REST는 rewrite를 경유한다. WebSocket만 문서 API 오리진에 직접 붙는다.

- 호출 지점: 17 (REST 16 + WebSocket 1)
- 호출 경로: 16 + WebSocket 1

## 회의와 실시간 받아쓰기

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/meetings` | 회의 생성(실시간 `live`·녹음 파일 `upload`) | `web/src/entities/meeting/api/meetings.ts` `createMeeting` | `workspacePath(getWorkspaceId(), "meetings")` | `Idempotency-Key`, `{ source: "live" \| "upload", document_id?, display_name? }` | `meeting_id`, `document_id` | 편집 중인 Markdown 문서가 있으면(`markdownEditContext.documentId`) `document_id`로 보내 회의록을 그 문서 끝에 추가할 수 있게 한다. 마이크 권한을 먼저 받은 뒤 만든다 |
| `GET /api/workspaces/{workspace_id}/meetings` | 내가 만든 회의 목록(최근 생성 순, cursor 페이지) | `web/src/entities/meeting/api/meetings.ts` `fetchMeetings` ← `web/src/features/meeting-dictation/model/useMeetingList.ts`(`useInfiniteQuery`) | `workspacePath(getWorkspaceId(), "meetings")` + `buildMeetingListQuery`(`lib/meetingListQuery.ts`) | `cursor`, `limit=20`. `status`는 보내지 않는다(전부). 빈 `status=`는 만들지 않는다 | `items[].meeting_id·display_name·source·status·has_recording·has_notes·created_at`, `next_cursor` | 파형 버튼 메뉴 "지난 회의" → 목록(`ui/MeetingListView.tsx`, "더 보기"로 다음 페이지). 고르면 `GET …/meetings/{id}`와(끝난 회의면) `GET …/notes`로 상태에 맞는 화면을 연다(`lib/meetingResume.ts`): 전사 중은 진행 조회, 실패는 `error` 문구, 회의록 생성 중·완성·저장됨, 녹음이 있으면 재생. 이 목록 덕분에 전사·회의록 생성 중에도 회의 화면을 닫을 수 있고, 탭을 닫기 전 확인은 조각을 올리는 동안만 받는다 |
| `POST /api/workspaces/{workspace_id}/meetings/{meeting_id}/live-tickets` | WebSocket용 60초 일회용 ticket | `web/src/entities/meeting/api/meetings.ts` `issueMeetingLiveTicket` | `workspacePath(getWorkspaceId(), "meetings", meetingId, "live-tickets")` | 없음 | `ticket` | 연결·재연결마다 새로 받는다. `409 MEETING_LIVE_IN_USE`는 다시 시도하지 않고 서버 문구로 끝낸다 |
| `WS /api/meetings/{meeting_id}/live?ticket=` | 오디오 전송·전사 이벤트 수신 | `web/src/features/meeting-dictation/model/liveSession.ts` `createLiveSession`, `useMeetingSession.ts` `openLiveSocket` | `buildLiveSocketUrl(transport.origin, location.origin, …)` (`lib/liveProtocol.ts`) | 바이너리 PCM16 LE mono 24kHz(frame ≤ 48,000 bytes), `{"type":"commit"}`(2초 이후 쉼 또는 15초마다), `{"type":"finish"}` | `ready`, `committed`, `delta`, `completed`, `finished`, `error.code`, close `4409` | `getDocumentTransport().origin`(BACKEND_URL)이 있으면 그 오리진의 `ws(s)`로, 없으면 화면 오리진으로 붙는다(로컬은 Next rewrite가 upgrade를 중계한다). CSP `connect-src`에 BACKEND_URL의 ws(s) 오리진을 넣었다. `ready` 전 음성은 모아 두었다가(최대 30초) 보낸다. 끊기면 새 ticket으로 최대 3번 다시 붙고, 55분이 되면 `finish` 뒤 새 연결로 넘긴다. `insufficient_credit`·`transcript_limit`(10만 자)·`meeting_not_open`·4409는 다시 붙지 않고 안내한다. 마이크는 `getUserMedia` + `ScriptProcessor`(`model/microphoneCapture.ts`)로 받아 24kHz로 줄인다 |

## 녹음 파일 전사·재생·회의 삭제

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/meetings/{meeting_id}/recording/uploads` | 녹음 원본 직접 업로드 시작(ticket) | `web/src/entities/meeting/api/meetings.ts` `uploadMeetingRecording` → `web/src/entities/document/api/multipartUpload.ts` `uploadDirectMultipart` | `workspacePath(…, "meetings", meetingId, "recording", "uploads")` | `{ content_type, size }` | `ticket`, `part_size`, `part_count` | PDF 직접 업로드와 같은 절차·코드다. 형식(WAV·MP3·M4A·WebM)과 크기(1 byte–500 MiB)는 `checkRecordingFile`(`web/src/entities/meeting/lib/recordingFile.ts`)이 먼저 막고, 브라우저가 형식을 비워 두면 확장자로 정한다. 녹음 파일 회의는 `source: "upload"`로 만든 뒤(이름은 파일 이름) 올린다. `402 INSUFFICIENT_CREDIT`는 공통 문구 |
| `POST …/recording/uploads/parts` | 조각별 presigned PUT URL | 같음 | `…/recording/uploads/parts` | `{ ticket, first_part, count }`(3개씩) | `parts[].part_number`, `parts[].url` | 각 URL에 조각을 XHR `PUT`(유휴 60초 제한, 실패 조각만 3회 재시도). 조각이 끝날 때마다 진행률(%)을 보인다 |
| `POST …/recording/uploads/complete` | 조각 조립·확정, 전사 시작 | 같음 | `…/recording/uploads/complete` | `{ ticket }` | `MeetingResponse`(`202 status=transcribing`) | 5xx는 backoff 후 3번까지 |
| `POST …/recording/uploads/abort` | 업로드 중단 | 같음 | `…/recording/uploads/abort` | `{ ticket }` | 없음 | 실패하거나 "올리기 취소"를 누르면 보낸다. 취소면 이번에 만든 빈 회의는 `DELETE`로 지운다 |
| `GET /api/workspaces/{workspace_id}/meetings/{meeting_id}` | 전사 진행 확인 | `web/src/entities/meeting/api/meetings.ts` `fetchMeeting` | `workspacePath(…, "meetings", meetingId)` | `cache: no-store` | `status`, `segments`, `error`, `has_recording` | `transcribing` 동안 3초마다 조회한다. `open`이면 구간을 카드에 보이고 회의록을 바로 요청한다. `failed`면 `error` 문구를 보이고 같은 회의에 다시 올릴 수 있다 |
| `POST …/meetings/{meeting_id}/transcription/cancel` | 전사 취소 | `cancelMeetingTranscription` | `…/transcription/cancel` | 없음 | `MeetingResponse`(`status=failed`, `error`) | "전사 취소" 버튼. `409 MEETING_NOT_TRANSCRIBING`이면 회의를 다시 조회해 결과를 보인다 |
| `GET …/meetings/{meeting_id}/recording-url` | 녹음 재생 주소(5분) | `fetchMeetingRecordingUrl` | `…/recording-url` | `cache: no-store` | `url`, `expires_at` | `has_recording`이면 "녹음 듣기" 버튼 → `<audio controls>`(`ui/MeetingRecordingPlayer.tsx`). 만료 15초 전 이후 재생을 시작하거나 재생 오류가 나면 새 주소를 받아 같은 위치부터 잇는다(오류 연속 2번까지). CSP `media-src`에 S3 오리진을 넣었다 |
| `DELETE /api/workspaces/{workspace_id}/meetings/{meeting_id}` | 회의·전사·초안·녹음 삭제 | `deleteMeeting` | `workspacePath(…, "meetings", meetingId)` | 없음 | 없음(`204`) | 제목 줄 "삭제" → 확인 모달(`ui/MeetingDeleteConfirm.tsx`) 뒤 호출하고 회의 화면을 닫는다(알림 카드, 포커스는 입력창). 멈춘·완성·저장된 단계에서만 보인다. `409 MEETING_TRANSCRIBING`·`MEETING_LIVE_IN_USE`·`MEETING_RECORDING_CHANGED`, `503 MEETING_RECORDING_STORAGE_FAILED`는 `describeMeetingRecordingError`(`web/src/shared/lib/aiErrorCodes.ts`) 문구. 404는 이미 지운 것으로 본다 |

## 회의록 초안과 저장

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/workspaces/{workspace_id}/meetings/{meeting_id}/notes` | 확정 전사로 초안 생성(비동기) | `web/src/entities/meeting/api/meetings.ts` `requestMeetingNotes` | `workspacePath(…, "meetings", meetingId, "notes")` + `?allow_partial=true`(선택) | `Idempotency-Key`(같은 요청의 재시도는 같은 키) | `status`, `version`, `error_code` | 받아쓰기가 `finished`로 끝나거나 녹음 파일 전사가 `open`으로 끝나면 자동으로 요청한다. `409 MEETING_LIVE_IN_USE`는 1.5초 간격 3번까지 다시 보낸다. `409 MEETING_TRANSCRIPT_INCOMPLETE`면 "저장된 내용으로 회의록 만들기"(`allow_partial`)를 보여 준다. `422 MEETING_TRANSCRIPT_EMPTY`·`409 MEETING_NOTES_BUSY`는 안내만 한다 |
| `GET /api/workspaces/{workspace_id}/meetings/{meeting_id}/notes` | 최신 초안 조회 | `web/src/entities/meeting/api/meetings.ts` `fetchMeetingNotes` | `workspacePath(…, "notes")` | `cache: no-store` | `status`, `markdown`, `version`, `error_code`, `applied` | `generating` 동안 2초마다 조회한다. `failed`는 `describeMeetingNotesError`(`web/src/shared/lib/aiErrorCodes.ts`)로 안내한다(`INSUFFICIENT_CREDIT` 포함) |
| `POST /api/workspaces/{workspace_id}/meetings/{meeting_id}/notes/cancel` | 만드는 초안 취소 | `web/src/entities/meeting/api/meetings.ts` `cancelMeetingNotes` | `workspacePath(…, "notes", "cancel")` | 없음 | `status` | "회의록 만들기 취소" 버튼 |
| `POST /api/workspaces/{workspace_id}/meetings/{meeting_id}/notes/{version}/append-preview` | 회의를 시작한 문서 끝에 붙인 결과 미리보기 | `web/src/entities/meeting/api/meetings.ts` `previewMeetingNotesAppend` | `workspacePath(…, "notes", version, "append-preview")` | `{}` | `document_id`, `base_revision`, `markdown` | 회의에 `document_id`가 있을 때만 "문서 끝에 추가" 버튼이 보인다. 결과 본문을 카드에 그대로 보여 준다 |
| `POST /api/workspaces/{workspace_id}/meetings/{meeting_id}/notes/{version}/apply` | 새 문서로 저장 또는 문서 끝에 추가 | `web/src/entities/meeting/api/meetings.ts` `applyMeetingNotes` | `workspacePath(…, "notes", version, "apply")` | `Idempotency-Key`, `{ mode: "create" }` 또는 `{ mode: "append", document_id, base_revision }` | `applied.document_id` | 저장 뒤 `usePendingDocumentOpen.openSavedDocument`가 문서 목록을 새로 받고 그 문서를 연다. `409 DOCUMENT_REVISION_CHANGED`·`MEETING_NOTES_OUTDATED`·`MEETING_NOTES_ALREADY_APPLIED`는 `describeNotesSaveError` 문구 |

## UI 위치

- 회의록 화면: `web/src/features/meeting-dictation/ui/MeetingNotesView.tsx` (`web/src/widgets/agent-panel/ui/AgentPanel.tsx`가 채팅 대화 자리에 띄운다)
- 시작·멈춤: `web/src/features/agent-chat/ui/AgentComposer.tsx` 파형 버튼(메뉴: 음성으로 입력 · 회의 받아쓰기 · 녹음 파일로 전사)
- 녹음 파일 선택: `web/src/features/meeting-dictation/ui/RecordingFileInput.tsx`(숨은 `input[type=file]`, `AgentPanel`이 둔다)

## 호출하지 않는 회의 경로

없다. 회의 목록 API가 없어 새로고침 뒤 진행 중이던 회의를 다시 여는 화면은 없다.
