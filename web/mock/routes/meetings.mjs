// document-svc(8080) 회의 받아쓰기 라우트(#148, Fruition-document docs/api/meetings.md).
// 회의 생성·목록·조회·ticket·삭제, 실시간 받아쓰기 WebSocket, 회의록 초안(비동기)·취소·끝에 추가 미리보기·저장을 흉내 낸다.
// 녹음 파일 업로드(recording/uploads*)·전사 취소·재생 주소는 meetingRecordings.mjs가 맡는다.
//
// 환경 변수: MOCK_MEETING_DELAY_MS(전사 조각 간격, 기본 150), MOCK_MEETING_NOTES_DELAY_MS(회의록 생성 시간, 기본 3000),
// MOCK_MEETING_LIVE_ERROR(세 번째 구간에서 보낼 error code: insufficient_credit·transcript_limit·transcription_failed 등),
// MOCK_INSUFFICIENT_CREDIT=1(회의록 초안이 INSUFFICIENT_CREDIT로 바로 실패),
// MOCK_MEETING_FETCH_DELAY_MS(회의 조회 응답을 다음 N ms 경계까지 붙잡는다. 멈췄던 서버가 밀린 조회에 한꺼번에 답하는 경우,
// 즉 전사 조회가 주기보다 느려 겹친 조회가 함께 돌아오는 경우 확인용, 기본 0).
import { randomUUID } from "node:crypto";
import { error, findDocument, hash, id, isMarkdownDocument, now, requireDocumentEdit, requireWorkspace, state } from "../state.mjs";
import { acceptWebSocket, rejectUpgrade } from "../lib/websocket.mjs";
import { forgetMeetingRecording, registerMeetingRecordingRoutes } from "./meetingRecordings.mjs";

const LIVE_SAMPLE_RATE = 24_000;
const MAX_FRAME_BYTES = 48_000;
const MIN_COMMIT_BYTES = LIVE_SAMPLE_RATE * 2 / 10; // 0.1초
const TICKET_TTL_MS = 60_000;
const READY_DELAY_MS = 400;
const DEFAULT_PIECE_DELAY_MS = 150;
const DEFAULT_NOTES_DELAY_MS = 3_000;
const ERROR_AT_SEGMENT = 3;

// 구간마다 차례로 돌려줄 받아쓰기 문장. 실제 음성 내용과 상관없다.
const SCRIPT = [
  "베타 서비스 출시 준비 회의를 시작하겠습니다.",
  "9월 23일 베타 출시를 앞두고 개발과 디자인 진행 상황을 점검하겠습니다.",
  "회원가입과 로그인 기능 구현은 완료했습니다.",
  "비밀번호 재설정 메일이 늦게 도착하는 문제가 있어 원인 확인이 필요합니다.",
  "모바일에서 온보딩 버튼이 잘리는 부분은 9월 17일까지 수정하겠습니다.",
  "초기 베타 사용자는 50명으로 제한하기로 하겠습니다.",
  "전체 테스트는 9월 21일 오후 2시에 진행합니다.",
  "메일 문제가 해결되지 않으면 출시 일정을 다시 논의하겠습니다."
];

const pieceDelay = () => Number(process.env.MOCK_MEETING_DELAY_MS ?? DEFAULT_PIECE_DELAY_MS);
const notesDelay = () => Number(process.env.MOCK_MEETING_NOTES_DELAY_MS ?? DEFAULT_NOTES_DELAY_MS);
// 서버가 프로세스를 붙잡고 있으므로 예약 작업은 프로세스 종료를 막지 않게 unref한다(테스트가 바로 끝난다).
const later = (ms, fn) => (ms > 0 ? setTimeout(fn, ms).unref() : setImmediate(fn));

// 테스트가 state를 직접 채우거나 비울 수 있어 매번 state에서 읽는다.
const meetings = () => state.meetings;
const tickets = () => state.meetingTickets;

function findOwnMeeting(ctx, workspaceId) {
  const meeting = meetings().find((item) => item.meeting_id === ctx.params.mid && item.workspace_id === workspaceId && item.owner_user_id === ctx.user.id);
  if (!meeting) error(ctx, 404, "회의를 찾을 수 없습니다.", "MEETING_NOT_FOUND");
  return meeting ?? null;
}

function transcriptComplete(meeting) {
  return !meeting.live_connected
    && meeting.segments.every((segment) => segment.status === "completed")
    && meeting.streams.every((stream) => stream.end_reason === "finished");
}

function toMeetingResponse(meeting) {
  return {
    created_at: meeting.created_at,
    display_name: meeting.display_name,
    document_id: meeting.document_id,
    live_connected: meeting.live_connected,
    meeting_id: meeting.meeting_id,
    segments: [...meeting.segments].sort((a, b) => a.position - b.position).map(({ id: segmentId, position, status, text }) => ({ id: segmentId, position, status, text })),
    source: meeting.source,
    status: meeting.status,
    streams: meeting.streams.map(({ stream_order, end_reason }) => ({ stream_order, end_reason })),
    transcript_complete: transcriptComplete(meeting),
    has_recording: Boolean(meeting.recording),
    error: meeting.error ?? null
  };
}

const LIST_STATUSES = new Set(["open", "awaiting_upload", "transcribing", "failed"]);
const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 100;

/** 회의 목록 항목. 구간·연결 기록은 넣지 않는다. has_notes는 ready·applied 초안이 있을 때만 true다. */
function toMeetingListItem(meeting) {
  return {
    created_at: meeting.created_at,
    display_name: meeting.display_name,
    has_notes: meeting.notes.some((notes) => notes.status === "ready" || notes.status === "applied"),
    has_recording: Boolean(meeting.recording),
    meeting_id: meeting.meeting_id,
    source: meeting.source,
    status: meeting.status,
    updated_at: meeting.updated_at ?? meeting.created_at
  };
}

function latestNotes(meeting) {
  return meeting.notes.at(-1) ?? null;
}

function toNotesResponse(meeting, notes) {
  const lastReady = [...meeting.notes].reverse().find((item) => item.status === "ready" || item.status === "applied");
  return {
    meeting_id: meeting.meeting_id,
    version: notes.version,
    status: notes.status,
    partial: notes.partial,
    display_name: notes.display_name,
    markdown: notes.markdown,
    meeting_date: notes.meeting_date,
    attendees: notes.attendees,
    summary: notes.summary,
    discussion: notes.discussion,
    decisions: notes.decisions,
    action_items: notes.action_items,
    next_schedule: notes.next_schedule,
    open_questions: notes.open_questions,
    applied: notes.applied,
    error_code: notes.error_code,
    last_ready_version: notes.status === "failed" ? lastReady?.version ?? null : null
  };
}

/**
 * AI처럼 Figma 시안 구성으로 회의록 본문을 만든다(document meetings.md 예시와 같은 모양).
 * `# 이름` → `- 날짜:`·`- 참석자:` → `### 회의 요약`·`### 주요 논의`(`####` 주제)·`### 결정 사항`·`### 해야 할 일`·`### 다음 일정`.
 * 빈 항목은 "확인된 내용 없음". 미결 사항은 본문에 넣지 않는다.
 */
function notesMarkdown(name, sections) {
  const list = (items) => (items.length ? items.map((item) => `- ${item.text}`) : ["- 확인된 내용 없음"]);
  const block = (title, lines) => [`### ${title}`, ...lines].join("\n");
  const head = [`- 날짜: ${sections.meeting_date}`, ...(sections.attendees.length ? [`- 참석자: ${sections.attendees.join(", ")}`] : [])];
  const discussion = sections.discussion.length
    ? sections.discussion.flatMap((topic) => [`#### ${topic.topic}`, ...list(topic.items)])
    : ["- 확인된 내용 없음"];
  const actions = sections.action_items.length
    ? sections.action_items.map((item) => `- [ ] ${item.text} · ${item.owner ?? "담당자 미정"} · ${item.due ?? "기한 미정"}`)
    : ["- 확인된 내용 없음"];
  return [
    `# ${name}`, head.join("\n"), block("회의 요약", list(sections.summary)), block("주요 논의", discussion),
    block("결정 사항", list(sections.decisions)), block("해야 할 일", actions), block("다음 일정", list(sections.next_schedule))
  ].join("\n\n");
}

/** 회의를 만든 시각의 한국 날짜(YYYY-MM-DD) */
function koreanDate(iso) {
  return new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function draftFrom(meeting) {
  const completed = meeting.segments.filter((segment) => segment.status === "completed").sort((a, b) => a.position - b.position);
  const item = (segment) => ({ text: segment.text, source_segment_ids: [segment.id] });
  const matching = (pattern) => completed.filter((segment) => pattern.test(segment.text));
  const progress = matching(/완료|문제|점검/).map(item);
  // 실시간 회의만 받아쓴 사람(회의 소유자)을 참석자로 안다. 녹음 파일은 비워 둔다.
  const owner = state.users.find((user) => user.id === meeting.owner_user_id);
  return {
    meeting_date: koreanDate(meeting.created_at),
    attendees: meeting.source === "live" && owner?.display_name ? [owner.display_name] : [],
    summary: completed.slice(0, 3).map(item),
    discussion: progress.length ? [{ topic: "진행 상황", items: progress }] : [],
    decisions: matching(/하기로|확정|제한/).map(item),
    action_items: matching(/수정|확인이 필요|정리/).map((segment) => ({
      ...item(segment), owner: null, due: /(\d+월 \d+일)까지/.exec(segment.text)?.[1] ?? null
    })),
    next_schedule: matching(/\d+시에|진행합니다/).map(item),
    open_questions: matching(/다시 논의/).map(item)
  };
}

function workspaceBusy(workspaceId) {
  return meetings().some((meeting) => meeting.workspace_id === workspaceId && meeting.notes.some((notes) => notes.status === "generating"));
}

export function registerMeetingRoutes(router) {
  registerMeetingRecordingRoutes(router, { findOwnMeeting, toMeetingResponse });

  router.post("/api/workspaces/:wid/meetings", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const key = ctx.req.headers["idempotency-key"];
    if (!key) return error(ctx, 400, "Idempotency-Key 헤더가 필요합니다.", "INVALID_MEETING");
    const body = await ctx.body();
    const existing = meetings().find((meeting) => meeting.idempotency_key === key && meeting.owner_user_id === ctx.user.id);
    if (existing) return ctx.json(201, toMeetingResponse(existing));
    if (body.source !== "live" && body.source !== "upload") return error(ctx, 400, "source는 live 또는 upload여야 합니다.", "INVALID_MEETING");
    if (body.document_id) {
      const doc = findDocument(workspace.id, body.document_id);
      if (!doc || !isMarkdownDocument(doc)) return error(ctx, 404, "문서를 찾을 수 없습니다.");
      if (!requireDocumentEdit(ctx, doc)) return;
    }
    const meeting = {
      meeting_id: id("mtg"), workspace_id: workspace.id, owner_user_id: ctx.user.id, idempotency_key: key,
      display_name: body.display_name || "회의록", document_id: body.document_id ?? null, source: body.source,
      status: body.source === "live" ? "open" : "awaiting_upload", live_connected: false,
      segments: [], streams: [], notes: [], notes_keys: new Map(), created_at: now()
    };
    meetings().push(meeting);
    ctx.json(201, toMeetingResponse(meeting));
  });

  // 내가 만든 회의 목록(최근 생성 순, cursor 페이지). status는 쉼표 목록이고 생략하거나 비우면 전부다.
  router.get("/api/workspaces/:wid/meetings", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const statuses = (ctx.query.get("status") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (statuses.some((status) => !LIST_STATUSES.has(status))) return error(ctx, 400, "허용하지 않는 status입니다.", "INVALID_MEETING");
    const rawCursor = ctx.query.get("cursor");
    const offset = rawCursor ? Number(rawCursor) : 0;
    if (!Number.isInteger(offset) || offset < 0) return error(ctx, 400, "잘못된 cursor입니다.", "INVALID_MEETING");
    const requested = Number(ctx.query.get("limit") ?? LIST_DEFAULT_LIMIT);
    const limit = !Number.isFinite(requested) || requested < 1 ? LIST_DEFAULT_LIMIT : Math.min(Math.floor(requested), LIST_MAX_LIMIT);
    const own = meetings()
      .filter((meeting) => meeting.workspace_id === workspace.id && meeting.owner_user_id === ctx.user.id)
      .filter((meeting) => statuses.length === 0 || statuses.includes(meeting.status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.meeting_id.localeCompare(a.meeting_id));
    const page = own.slice(offset, offset + limit);
    const nextCursor = offset + limit < own.length ? String(offset + limit) : null;
    ctx.json(200, { items: page.map(toMeetingListItem), next_cursor: nextCursor });
  });

  router.get("/api/workspaces/:wid/meetings/:mid", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const fetchDelay = Number(process.env.MOCK_MEETING_FETCH_DELAY_MS ?? 0);
    if (fetchDelay > 0) await new Promise((resolve) => setTimeout(resolve, fetchDelay - (Date.now() % fetchDelay)));
    const meeting = findOwnMeeting(ctx, workspace.id);
    if (meeting) ctx.json(200, toMeetingResponse(meeting));
  });

  router.delete("/api/workspaces/:wid/meetings/:mid", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const meeting = findOwnMeeting(ctx, workspace.id);
    if (!meeting) return;
    if (meeting.status === "transcribing") return error(ctx, 409, "전사가 끝나거나 취소한 뒤 삭제해 주세요.", "MEETING_TRANSCRIBING");
    if (meeting.live_connected) return error(ctx, 409, "받아쓰기 연결 중에는 삭제할 수 없습니다.", "MEETING_LIVE_IN_USE");
    state.meetings = meetings().filter((item) => item !== meeting);
    forgetMeetingRecording(meeting.meeting_id);
    ctx.json(204, null);
  });

  router.post("/api/workspaces/:wid/meetings/:mid/live-tickets", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const meeting = findOwnMeeting(ctx, workspace.id);
    if (!meeting) return;
    if (meeting.source !== "live" || meeting.status !== "open") return error(ctx, 409, "실시간 받아쓰기를 할 수 없는 회의입니다.", "MEETING_NOT_OPEN");
    if (meeting.live_connected) return error(ctx, 409, "이미 다른 곳에서 받아쓰고 있습니다.", "MEETING_LIVE_IN_USE");
    const ticket = `wst_${randomUUID().replaceAll("-", "")}`;
    const expiresAt = Date.now() + TICKET_TTL_MS;
    tickets().set(ticket, { meetingId: meeting.meeting_id, expiresAt });
    ctx.json(200, { ticket, expires_at: new Date(expiresAt).toISOString() });
  });

  router.ws("/api/meetings/:mid/live", ({ req, socket, head, params, query }) => {
    const ticket = query.get("ticket");
    const entry = ticket ? tickets().get(ticket) : null;
    if (ticket) tickets().delete(ticket);
    if (!entry || entry.expiresAt < Date.now() || entry.meetingId !== params.mid) return rejectUpgrade(socket, 401, "Unauthorized");
    const meeting = meetings().find((item) => item.meeting_id === params.mid);
    if (!meeting) return rejectUpgrade(socket, 401, "Unauthorized");
    const connection = acceptWebSocket(req, socket, head);
    if (meeting.live_connected) {
      connection.close(4409, "meeting live in use");
      return;
    }
    startLiveStream(meeting, connection);
  });

  router.post("/api/workspaces/:wid/meetings/:mid/notes", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const meeting = findOwnMeeting(ctx, workspace.id);
    if (!meeting) return;
    const key = ctx.req.headers["idempotency-key"];
    if (!key) return error(ctx, 400, "Idempotency-Key 헤더가 필요합니다.");
    const previous = meeting.notes_keys.get(key);
    if (previous) return ctx.json(previous.status === "generating" ? 202 : 200, toNotesResponse(meeting, previous));
    if (workspaceBusy(workspace.id)) return error(ctx, 409, "이 워크스페이스에서 다른 회의록을 만들고 있습니다.", "MEETING_NOTES_BUSY");
    if (meeting.live_connected) return error(ctx, 409, "받아쓰기 중에는 회의록을 만들 수 없습니다.", "MEETING_LIVE_IN_USE");
    const allowPartial = ctx.query.get("allow_partial") === "true";
    if (!meeting.segments.some((segment) => segment.status === "completed")) return error(ctx, 422, "확정된 전사가 없습니다.", "MEETING_TRANSCRIPT_EMPTY");
    if (!transcriptComplete(meeting) && !allowPartial) return error(ctx, 409, "누락되었거나 비정상 종료된 전사가 있습니다.", "MEETING_TRANSCRIPT_INCOMPLETE");
    const notes = {
      version: meeting.notes.length + 1, status: "generating", partial: allowPartial, display_name: meeting.display_name,
      markdown: null, meeting_date: null, attendees: [], summary: [], discussion: [], decisions: [], action_items: [], next_schedule: [], open_questions: [], applied: null, error_code: null, apply_keys: new Map()
    };
    meeting.notes.push(notes);
    meeting.notes_keys.set(key, notes);
    if (["1", "true"].includes(process.env.MOCK_INSUFFICIENT_CREDIT ?? "")) {
      Object.assign(notes, { status: "failed", error_code: "INSUFFICIENT_CREDIT" });
      return ctx.json(200, toNotesResponse(meeting, notes));
    }
    later(notesDelay(), () => {
      if (notes.status !== "generating") return;
      const sections = draftFrom(meeting);
      Object.assign(notes, { status: "ready", ...sections, markdown: notesMarkdown(meeting.display_name, sections) });
    });
    ctx.json(202, toNotesResponse(meeting, notes));
  });

  router.get("/api/workspaces/:wid/meetings/:mid/notes", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const meeting = findOwnMeeting(ctx, workspace.id);
    if (!meeting) return;
    const notes = latestNotes(meeting);
    if (!notes) return error(ctx, 404, "회의록 초안이 없습니다.", "MEETING_NOTES_NOT_FOUND");
    ctx.json(200, toNotesResponse(meeting, notes));
  });

  router.post("/api/workspaces/:wid/meetings/:mid/notes/cancel", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const meeting = findOwnMeeting(ctx, workspace.id);
    if (!meeting) return;
    const notes = latestNotes(meeting);
    if (!notes || notes.status !== "generating") return error(ctx, 409, "만들고 있는 회의록이 없습니다.", "MEETING_NOTES_NOT_GENERATING");
    Object.assign(notes, { status: "failed", error_code: "MEETING_NOTES_CANCELLED" });
    ctx.json(200, toNotesResponse(meeting, notes));
  });

  router.post("/api/workspaces/:wid/meetings/:mid/notes/:version/append-preview", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const meeting = findOwnMeeting(ctx, workspace.id);
    if (!meeting) return;
    const notes = readyNotes(ctx, meeting);
    if (!notes) return;
    const body = await ctx.body();
    const doc = targetDocument(ctx, workspace, meeting, body.document_id);
    if (!doc) return;
    ctx.json(200, { document_id: doc.id, base_revision: doc.edit_revision, markdown: appended(doc.markdown, body.markdown ?? notes.markdown) });
  });

  router.post("/api/workspaces/:wid/meetings/:mid/notes/:version/apply", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const meeting = findOwnMeeting(ctx, workspace.id);
    if (!meeting) return;
    const key = ctx.req.headers["idempotency-key"];
    if (!key) return error(ctx, 400, "Idempotency-Key 헤더가 필요합니다.");
    const version = Number(ctx.params.version);
    const target = meeting.notes.find((item) => item.version === version);
    if (target?.apply_keys.has(key)) return ctx.json(200, toNotesResponse(meeting, target));
    if (target?.status === "applied") return error(ctx, 409, "이미 저장한 회의록입니다.", "MEETING_NOTES_ALREADY_APPLIED");
    const notes = readyNotes(ctx, meeting);
    if (!notes) return;
    const body = await ctx.body();
    const markdown = typeof body.markdown === "string" ? body.markdown : notes.markdown;
    let documentId;
    if (body.mode === "create") {
      documentId = createNotesDocument(workspace, ctx.user.id, body.display_name || notes.display_name, markdown, body.folder_id ?? null);
    } else if (body.mode === "append") {
      const doc = targetDocument(ctx, workspace, meeting, body.document_id);
      if (!doc) return;
      if (!Number.isInteger(body.base_revision)) return error(ctx, 400, "base_revision이 필요합니다.");
      if (body.base_revision !== doc.edit_revision) return error(ctx, 409, "미리 본 뒤 문서가 바뀌었습니다.", "DOCUMENT_REVISION_CHANGED");
      saveMarkdown(doc, appended(doc.markdown, markdown), ctx.user.id);
      documentId = doc.id;
    } else {
      return error(ctx, 400, "mode는 create 또는 append여야 합니다.");
    }
    Object.assign(notes, { status: "applied", applied: { mode: body.mode, document_id: documentId, applied_at: now() } });
    notes.apply_keys.set(key, true);
    ctx.json(200, toNotesResponse(meeting, notes));
  });
}

function readyNotes(ctx, meeting) {
  const version = Number(ctx.params.version);
  const notes = meeting.notes.find((item) => item.version === version);
  if (!notes) {
    error(ctx, 404, "회의록 초안이 없습니다.", "MEETING_NOTES_NOT_FOUND");
    return null;
  }
  const lastReady = [...meeting.notes].reverse().find((item) => item.status === "ready" || item.status === "applied");
  if (notes !== lastReady) {
    error(ctx, 409, "최신 회의록 초안이 아닙니다.", "MEETING_NOTES_OUTDATED");
    return null;
  }
  if (notes.status === "applied") {
    error(ctx, 409, "이미 저장한 회의록입니다.", "MEETING_NOTES_ALREADY_APPLIED");
    return null;
  }
  return notes;
}

function targetDocument(ctx, workspace, meeting, documentId) {
  const targetId = documentId ?? meeting.document_id;
  if (!targetId) {
    error(ctx, 400, "회의록을 추가할 문서가 없습니다.");
    return null;
  }
  const doc = findDocument(workspace.id, targetId);
  if (!doc || !isMarkdownDocument(doc)) {
    error(ctx, 404, "문서를 찾을 수 없습니다.");
    return null;
  }
  return requireDocumentEdit(ctx, doc) ? doc : null;
}

/** 현재 본문 끝 공백을 지우고 빈 줄 하나 뒤에 회의록을 붙인다. */
function appended(current, notesMarkdownText) {
  const base = (current ?? "").replace(/\s+$/, "");
  return base ? `${base}\n\n${notesMarkdownText}\n` : `${notesMarkdownText}\n`;
}

function saveMarkdown(doc, markdown, userId) {
  const buffer = Buffer.from(markdown, "utf8");
  doc.current_version += 1;
  doc.edit_revision = doc.current_version;
  Object.assign(doc, { markdown, content: buffer, byte_size: buffer.length, updated_at: now(), updated_by: userId });
  doc.versions?.push({ version: doc.current_version, content_hash: hash(markdown), created_by: userId, created_at: doc.updated_at, markdown });
}

function createNotesDocument(workspace, userId, name, markdown, folderId) {
  const base = name.replace(/[\\/:*?"<>|]/g, " ").trim() || "회의록";
  let filename = `${base}.md`;
  for (let index = 2; state.documents.some((doc) => doc.workspace_id === workspace.id && doc.folder_id === folderId && doc.filename === filename && !doc.deleted_at); index += 1) {
    filename = `${base} (${index}).md`;
  }
  const buffer = Buffer.from(markdown, "utf8");
  const timestamp = now();
  const doc = {
    id: id("doc"), workspace_id: workspace.id, filename, mime_type: "text/markdown", byte_size: buffer.length, status: "uploaded",
    folder_id: folderId, sort_order: 0, source_uri: `mock://meetings/${filename}`, uploaded_at: timestamp, updated_at: timestamp,
    document_role: "EDITABLE", markdown, content: buffer, owner_user_id: userId, permission: null,
    current_version: 1, edit_revision: 1,
    versions: [{ version: 1, content_hash: hash(markdown), created_by: userId, created_at: timestamp, markdown }]
  };
  state.documents.push(doc);
  return doc.id;
}

/** 연결 하나: ready → (오디오·commit → committed·delta·completed)* → finish → finished + close 1000 */
function startLiveStream(meeting, connection) {
  meeting.live_connected = true;
  const stream = { stream_order: meeting.streams.length + 1, end_reason: null };
  meeting.streams.push(stream);
  let isReady = false;
  let isFinishing = false;
  let bytesSinceCommit = 0;
  let segmentCount = 0;
  let inFlight = 0;
  let itemIndex = 0;
  const readyTimer = setTimeout(() => {
    isReady = true;
    connection.sendJson({ type: "ready", sample_rate: LIVE_SAMPLE_RATE, stream_order: stream.stream_order });
  }, READY_DELAY_MS);

  function fail(code, message, closeCode) {
    connection.sendJson({ type: "error", code, message });
    connection.close(closeCode);
  }

  function maybeFinish() {
    if (!isFinishing || inFlight > 0) return;
    stream.end_reason = "finished";
    connection.sendJson({ type: "finished", segment_count: segmentCount });
    connection.close(1000);
  }

  function commitSegment() {
    if (bytesSinceCommit < MIN_COMMIT_BYTES) return;
    bytesSinceCommit = 0;
    itemIndex += 1;
    const position = meeting.segments.length + 1;
    const segment = { id: `s${stream.stream_order}_item_${itemIndex}`, position, status: "pending", text: null };
    const previous = meeting.segments.at(-1)?.id ?? null;
    meeting.segments.push(segment);
    segmentCount += 1;
    if (process.env.MOCK_MEETING_LIVE_ERROR && meeting.segments.length >= ERROR_AT_SEGMENT) {
      const code = process.env.MOCK_MEETING_LIVE_ERROR;
      meeting.segments.pop();
      return fail(code, `mock ${code}`, ["insufficient_credit", "transcript_limit", "meeting_not_open"].includes(code) ? 1008 : 1011);
    }
    inFlight += 1;
    const sentence = SCRIPT[(position - 1) % SCRIPT.length];
    const pieces = sentence.match(/.{1,8}/gu) ?? [sentence];
    // 계약대로 delta가 committed보다 먼저 올 수 있게 첫 조각을 먼저 보낸다.
    connection.sendJson({ type: "delta", segment_id: segment.id, text: pieces[0] });
    connection.sendJson({ type: "committed", segment_id: segment.id, previous_segment_id: previous, position });
    pieces.slice(1).forEach((piece, index) => later(pieceDelay() * (index + 1), () => {
      if (connection.readyState() === 1) connection.sendJson({ type: "delta", segment_id: segment.id, text: piece });
    }));
    later(pieceDelay() * pieces.length, () => {
      inFlight -= 1;
      if (connection.readyState() !== 1) return;
      Object.assign(segment, { status: "completed", text: sentence });
      connection.sendJson({ type: "completed", segment_id: segment.id, text: sentence });
      maybeFinish();
    });
  }

  connection.on("message", (data, isBinary) => {
    if (!isReady) return fail("invalid_audio", "ready 전에 보낸 메시지입니다.", 1008);
    if (isBinary) {
      if (data.length % 2 !== 0 || data.length > MAX_FRAME_BYTES) return fail("invalid_audio", "오디오 frame이 올바르지 않습니다.", 1008);
      bytesSinceCommit += data.length;
      return;
    }
    let message;
    try {
      message = JSON.parse(data.toString("utf8"));
    } catch {
      return fail("invalid_audio", "알 수 없는 명령입니다.", 1008);
    }
    if (message.type === "commit") return commitSegment();
    if (message.type === "finish") {
      commitSegment();
      isFinishing = true;
      return maybeFinish();
    }
    fail("invalid_audio", "알 수 없는 명령입니다.", 1008);
  });

  connection.on("close", () => {
    clearTimeout(readyTimer);
    meeting.live_connected = false;
    if (!stream.end_reason) stream.end_reason = "interrupted";
  });
}
