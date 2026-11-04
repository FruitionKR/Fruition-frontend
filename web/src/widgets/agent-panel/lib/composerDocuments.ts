import { isDocumentConverting, isMarkdownDocument } from "@/entities/document/lib/documentKind";
import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { AgentTurnRequest } from "@/features/agent-chat/lib/agentTurn";
import { slashCommandSlug } from "@/features/agent-chat/lib/taskThread";
import { documentDisplayName, filterPickerDocuments, orderPickerDocuments } from "@/features/skill-authoring/lib/referenceDocumentPicker";
import { ApiError, isInsufficientCreditError } from "@/shared/lib/apiErrors";

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
 * 고를 수 있는 문서.
 * 이미 고른 문서는 빼고, 현재 문서는 칩이 붙어 있지 않을 때만 맨 앞에 넣는다.
 * 3개를 다 골라도 열린 문서는 첨부 수에 들지 않아 ×로 뺀 현재 문서는 다시 붙일 수 있다.
 */
export function composerDocumentOptions({
  documents,
  query,
  attachments,
  openDocumentId,
  isOpenDocumentAttached
}: {
  documents: DocumentItemResponse[];
  query: string;
  attachments: readonly DocumentItemResponse[];
  openDocumentId: string | null;
  isOpenDocumentAttached: boolean;
}): DocumentItemResponse[] {
  const attachedIds = new Set(attachments.map((document) => document.id));
  const isFull = attachments.length >= REFERENCE_DOCUMENT_MAX;
  const pinned = isOpenDocumentAttached ? [] : documents.filter((document) => document.id === openDocumentId);
  return filterPickerDocuments(orderPickerDocuments(pinned, [], documents), query).filter((document) => {
    if (!isAttachableDocument(document) || attachedIds.has(document.id)) return false;
    return document.id === openDocumentId ? !isOpenDocumentAttached : !isFull;
  });
}

export function canAddComposerDocument(attachmentCount: number, isOpenDocumentDetached: boolean): boolean {
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
 */
export function shouldRestoreAttachments(error: unknown, { referenceDocumentIds, turnId }: { referenceDocumentIds: readonly string[]; turnId: string | null }): boolean {
  if (referenceDocumentIds.length === 0) return false;
  if (isInsufficientCreditError(error)) return true;
  return turnId === null && error instanceof ApiError && error.status === 400;
}

/** 되돌린 첨부 중 지금 고를 수 없는 문서(삭제·권한 회수·변환 중)를 뺀다. */
export function pruneUnavailableAttachments(attachments: readonly DocumentItemResponse[], documents: DocumentItemResponse[]): DocumentItemResponse[] {
  const availableIds = new Set(documents.filter(isAttachableDocument).map((document) => document.id));
  return attachments.filter((document) => availableIds.has(document.id));
}
