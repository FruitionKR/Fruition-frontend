import { isDocumentReadOnly } from "@/entities/document/lib/documentAccess";
import { isDocumentConverting, isMarkdownDocument } from "@/entities/document/lib/documentKind";
import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { AgentTurnRequest } from "@/features/agent-chat/lib/agentTurn";
import { slashCommandSlug } from "@/features/agent-chat/lib/taskThread";
import { documentDisplayName, filterPickerDocuments, orderPickerDocuments } from "@/features/skill-authoring/lib/referenceDocumentPicker";
import { ApiError, DocumentLockedError, isInsufficientCreditError } from "@/shared/lib/apiErrors";

/** 한 요청에 첨부할 수 있는 문서 수(document AgentTurnRequest.reference_document_ids 계약). 열린 문서는 따로 실려 세지 않는다. */
export const REFERENCE_DOCUMENT_MAX = 3;
export const REFERENCE_DOCUMENT_LIMIT_MESSAGE = `문서는 ${REFERENCE_DOCUMENT_MAX}개까지 첨부할 수 있어요.`;

export type DocumentMention = {
  /** 커서 앞까지의 검색어 */
  query: string;
  /** "@"의 위치 */
  start: number;
  /** 고르면 지울 끝 위치(커서 뒤로 이어진 글자까지) */
  end: number;
};

/**
 * 입력의 커서 앞 "@검색어". 입력 처음이나 공백 뒤의 "@"만 열어 이메일 주소에서는 열리지 않는다.
 * 검색어에 공백이 들어가면 닫힌다. 커서를 모르면(입력을 건드리기 전 불러온 초안) 열지 않는다.
 */
export function parseDocumentMention(value: string, caret: number | null): DocumentMention | null {
  if (caret === null) return null;
  const match = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
  if (!match) return null;
  const tail = /^\S*/.exec(value.slice(caret))?.[0].length ?? 0;
  return { query: match[2], start: match.index + match[1].length, end: caret + tail };
}

/** 고른 뒤 입력에서 "@검색어"를 지운다. 앞뒤 공백이 겹치지 않게 뒤 공백 하나를 함께 지운다. */
export function removeDocumentMention(value: string, mention: DocumentMention): { value: string; caret: number } {
  const before = value.slice(0, mention.start);
  const after = value.slice(mention.end);
  const isAfterSpace = before === "" || /\s$/.test(before);
  return { value: before + (isAfterSpace ? after.replace(/^ /, "") : after), caret: before.length };
}

/**
 * 첨부할 수 있는 문서(document 규칙). 서버 목록이라 삭제된 문서·폴더는 없고, PDF 원본 같은 비편집 문서와 변환 중인 문서만 뺀다.
 * 저장한 회의록·채팅 내보내기·보기 권한 문서·완료된 변환본은 통과한다. 본문 없이 실패한 변환본은 목록으로 가려낼 수 없어 넣어 두고, 고르면 서버가 400으로 거절한다.
 */
function isAttachableDocument(document: DocumentItemResponse): boolean {
  return isMarkdownDocument(document) && !isDocumentConverting(document);
}

/**
 * 보기 권한으로 연 문서를 근거 첨부로 실을 때 그 문서 ID. 편집 문맥(documentId)으로 보내지 않아야 AI가 원문 수정안을 내지 않고
 * 서버의 쓰기 권한 검사도 그대로 남는다. 첨부로 받지 않는 문서(PDF 원본·변환 중)는 요청 전체가 400이 되므로 뺀다.
 */
export function readOnlyReferenceDocumentId(document: DocumentItemResponse | null | undefined): string | null {
  return document && isDocumentReadOnly(document) && isAttachableDocument(document) ? document.id : null;
}

/** 요청에 실을 첨부. 보기 권한으로 연 문서는 서버 한도(3개)에 함께 세고 겹쳐 싣지 않는다. */
export function turnReferenceDocumentIds(attachments: readonly Pick<DocumentItemResponse, "id">[], readOnlyDocumentId: string | null): string[] {
  const ids = attachments.map((document) => document.id);
  return readOnlyDocumentId && !ids.includes(readOnlyDocumentId) ? [readOnlyDocumentId, ...ids] : ids;
}

/** 입력창이 자동으로 실은 열린 문서. 사용자가 직접 첨부했거나 칩을 눌러 고른 문서면 null이다. */
export function autoIncludedOpenDocumentId(
  includedOpenDocumentId: string | null,
  { attachments, optedInDocumentId }: { attachments: readonly Pick<DocumentItemResponse, "id">[]; optedInDocumentId: string | null }
): string | null {
  if (includedOpenDocumentId === optedInDocumentId || attachments.some((document) => document.id === includedOpenDocumentId)) return null;
  return includedOpenDocumentId;
}

/**
 * 요청을 보내고, 시작되지 못한 400이면 자동으로 실은 열린 문서를 빼고 한 번만 다시 보낸다.
 * 서버는 어느 문서가 문제인지 알려 주지 않으므로(사유를 나누지 않는 400) 빼고 보낸 결과로 가린다. 직접 첨부한 문서가 문제면 다시 400이 되어 그 오류를 그대로 준다.
 * turn이 만들어지기 전의 400만 다시 보내므로 요청이 두 번 처리되지 않는다.
 */
export async function sendTurnDroppingOpenDocument<T>({ referenceDocumentIds, autoDocumentId, hasStarted, send }: {
  referenceDocumentIds: readonly string[];
  autoDocumentId: string | null;
  /** 서버가 turn을 받았는지. 받은 뒤의 실패는 다시 보내지 않는다. */
  hasStarted: () => boolean;
  send: (documentIds: string[]) => Promise<T>;
}): Promise<T> {
  try {
    return await send([...referenceDocumentIds]);
  } catch (error) {
    const isRejected = !hasStarted() && error instanceof ApiError && error.status === 400;
    if (!isRejected || autoDocumentId === null || !referenceDocumentIds.includes(autoDocumentId)) throw error;
    return send(referenceDocumentIds.filter((id) => id !== autoDocumentId));
  }
}

/** 자동으로 실은 열린 문서를 빼고 보냈을 때의 안내. */
export function droppedOpenDocumentMessage(title: string | null): string {
  return `${title ? `현재 문서 '${title}'` : "현재 문서"} 내용을 읽을 수 없어 빼고 요청을 보냈어요. 이 문서 없이 작업합니다.`;
}

/**
 * 고를 수 있는 문서.
 * 이미 고른 문서는 빼고, 현재 문서는 칩이 붙어 있지 않을 때만 맨 앞에 넣는다.
 * 3개를 다 골라도 편집 문맥으로 실리는 열린 문서는 첨부 수에 들지 않아 ×로 뺀 현재 문서는 다시 붙일 수 있다.
 * 보기 권한으로 연 문서(isOpenDocumentReference)는 첨부로 실려 자리를 차지한다.
 */
export function composerDocumentOptions({
  documents,
  query,
  attachments,
  openDocumentId,
  isOpenDocumentAttached,
  isOpenDocumentReference = false
}: {
  documents: DocumentItemResponse[];
  query: string;
  attachments: readonly DocumentItemResponse[];
  openDocumentId: string | null;
  isOpenDocumentAttached: boolean;
  isOpenDocumentReference?: boolean;
}): DocumentItemResponse[] {
  const attachedIds = new Set(attachments.map((document) => document.id));
  const usedCount = attachments.length + (isOpenDocumentReference && isOpenDocumentAttached ? 1 : 0);
  const isFull = usedCount >= REFERENCE_DOCUMENT_MAX;
  const pinned = isOpenDocumentAttached ? [] : documents.filter((document) => document.id === openDocumentId);
  return filterPickerDocuments(orderPickerDocuments(pinned, [], documents), query).filter((document) => {
    if (!isAttachableDocument(document) || attachedIds.has(document.id)) return false;
    if (document.id !== openDocumentId) return !isFull;
    return !isOpenDocumentAttached && !(isOpenDocumentReference && isFull);
  });
}

export function canAddComposerDocument(
  attachmentCount: number,
  isOpenDocumentDetached: boolean,
  { isOpenDocumentReference = false, isOpenDocumentAttached = false }: { isOpenDocumentReference?: boolean; isOpenDocumentAttached?: boolean } = {}
): boolean {
  if (isOpenDocumentReference) return attachmentCount + (isOpenDocumentAttached ? 1 : 0) < REFERENCE_DOCUMENT_MAX;
  return attachmentCount < REFERENCE_DOCUMENT_MAX || isOpenDocumentDetached;
}

/** 지금 첨부로 보여 주고 실을 문서. 함께 실리는 열린 문서는 겹쳐 싣지 않는다(고른 뒤 그 문서를 연 경우). */
export function referenceDocuments(attachments: readonly DocumentItemResponse[], includedOpenDocumentId: string | null): DocumentItemResponse[] {
  return attachments.filter((document) => document.id !== includedOpenDocumentId);
}

export function moveActiveOption(ids: readonly string[], activeId: string | null, step: number): string | null {
  if (ids.length === 0) return null;
  const index = activeId === null ? -1 : ids.indexOf(activeId);
  if (index < 0) return step > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(index + step + ids.length) % ids.length];
}

export function composerDocumentChipLabel(document: Pick<DocumentItemResponse, "filename">): string {
  return documentDisplayName(document).replace(/\.(md|markdown)$/i, "");
}

/**
 * 입력창을 거치지 않고 다시 보내는 요청(지난 기록 다시 시도·되묻기 답)이 앞선 요청의 첨부를 이어받을지.
 * 같은 대화의 마지막 요청과 문장이나 `/스킬`이 같을 때만 이어받는다. 지난 기록의 첨부는 화면이 모른다.
 */
export function followUpReferenceDocumentIds(
  lastRequest: Pick<AgentTurnRequest, "session_id" | "message" | "reference_document_ids"> | null,
  sessionId: string | null,
  message: string
): string[] {
  if (!lastRequest || lastRequest.session_id !== sessionId) return [];
  const slug = slashCommandSlug(message);
  const isSameRequest = lastRequest.message === message || (slug !== null && slug === slashCommandSlug(lastRequest.message));
  return isSameRequest ? lastRequest.reference_document_ids ?? [] : [];
}

/**
 * 첨부를 실은 요청이 시작되지 못해 입력과 첨부를 되돌릴지. 고른 문서를 쓸 수 없으면 서버가 turn을 만들기 전에 400을 준다.
 * 크레딧 부족은 입력을 되돌리는 동작에 맞춰 첨부도 되돌린다.
 * 열린 문서가 잠겨(423) 시작되지 못한 요청은 첨부가 없어도 입력을 되돌린다. 칩을 빼고 그대로 다시 보낼 수 있게 한다.
 */
export function shouldRestoreAttachments(error: unknown, { referenceDocumentIds, turnId }: { referenceDocumentIds: readonly string[]; turnId: string | null }): boolean {
  if (turnId === null && error instanceof ApiError && error.status === 423) return true;
  if (referenceDocumentIds.length === 0) return false;
  if (isInsufficientCreditError(error)) return true;
  return turnId === null && error instanceof ApiError && error.status === 400;
}

/**
 * 열린 문서 잠금(423) 안내. 첨부 문서가 잠긴 것처럼 읽히지 않게 어느 문서인지 밝히고, 첨부가 있으면 계속할 방법을 알려 준다.
 * 제목은 서버 값을 먼저 쓰고, 없으면 현재 문서 칩의 문서 제목을 쓴다. 423이 아니면 null이다.
 */
export function documentLockedTurnMessage(error: unknown, { openDocumentTitle, hasAttachments }: { openDocumentTitle: string | null; hasAttachments: boolean }): string | null {
  if (!(error instanceof ApiError) || error.status !== 423) return null;
  const title = (error instanceof DocumentLockedError ? error.documentTitle : null) ?? openDocumentTitle;
  const subject = title ? `현재 문서 '${title}'에서` : "현재 문서에서";
  const next = hasAttachments ? "현재 문서 칩을 빼면 첨부 문서로 계속할 수 있어요." : "편집이 끝난 뒤 다시 시도해 주세요.";
  return `${subject} 다른 사람이 편집 중이에요. ${next}`;
}

/** 채팅 탭의 질문을 문서 근거로 보낼지. 첨부도 내용 있는 열린 문서도 없으면 지금처럼 위키 질의다. */
export function asksFromDocuments(context: { editorSnapshot: { markdown: string } } | null, referenceDocumentIds: readonly string[]): boolean {
  return referenceDocumentIds.length > 0 || Boolean(context?.editorSnapshot.markdown.trim());
}

/** 작업 탭에서 옮긴 질문을 채팅 입력에 넣는다. 쓰던 초안은 지우지 않고, 이미 옮겼으면 겹치지 않는다. */
export function appendMovedQuestion(draft: string, question: string): string {
  if (!draft.trim()) return question;
  return draft.includes(question) ? draft : `${draft}\n${question}`;
}

/** 옮긴 첨부를 한도 안에서 뒤에 붙인다. 한도에 막힌 수를 함께 돌려준다. */
export function mergeMovedAttachments(
  current: readonly DocumentItemResponse[],
  moved: readonly DocumentItemResponse[],
  limit: number
): { documents: DocumentItemResponse[]; droppedCount: number } {
  const added = moved.filter((document) => !current.some((item) => item.id === document.id));
  const documents = [...current, ...added].slice(0, Math.max(limit, current.length));
  return { documents, droppedCount: current.length + added.length - documents.length };
}

export function serializeAttachments(documents: readonly DocumentItemResponse[]): string {
  return JSON.stringify(documents);
}

/** 저장해 둔 첨부. 깨졌거나 모양이 다른 값은 뺀다. 지금도 쓸 수 있는지는 최신 목록으로 다시 본다. */
export function parseStoredAttachments(raw: string | null): DocumentItemResponse[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is DocumentItemResponse => typeof item?.id === "string" && item.id !== "")
      .slice(0, REFERENCE_DOCUMENT_MAX);
  } catch {
    return [];
  }
}

/** 되돌린 첨부 중 지금 고를 수 없는 문서(삭제·권한 회수·변환 중)를 뺀다. */
export function pruneUnavailableAttachments(attachments: readonly DocumentItemResponse[], documents: DocumentItemResponse[]): DocumentItemResponse[] {
  const availableIds = new Set(documents.filter(isAttachableDocument).map((document) => document.id));
  return attachments.filter((document) => availableIds.has(document.id));
}
