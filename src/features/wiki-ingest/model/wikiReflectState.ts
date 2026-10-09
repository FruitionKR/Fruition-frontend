import type { DocumentItemResponse } from "@/entities/document/model/document";

/**
 * 문서가 위키에 반영된 정도.
 * - processing: 반영 작업이 진행 중이라 새 요청을 받을 수 없다.
 * - changed: 반영 이후 편집돼 재반영이 필요하다.
 * - not-included: 아직 한 번도 반영되지 않았다.
 * - retry: 직전 반영이 실패해 다시 시도할 수 있다.
 * - up-to-date: 최신 내용이 이미 반영돼 있다.
 */
export type WikiReflectState = "processing" | "changed" | "not-included" | "retry" | "up-to-date";

const WIKI_REFLECT_LABELS: Partial<Record<WikiReflectState, string>> = {
  changed: "수정됨",
  "not-included": "신규",
  retry: "재시도"
};

/**
 * 반영 작업이 아직 끝나지 않은 처리 단계.
 * stalled는 heartbeat가 60초 넘게 끊긴 상태일 뿐 실패 확정이 아니라서 진행 중으로 본다.
 * 진행 중으로 두어야 같은 문서에 반영 요청이 다시 나가지 않는다.
 */
const ACTIVE_PROCESSING_STATES = ["starting", "running", "stalled"] as const;

export function getWikiReflectState(document: DocumentItemResponse): WikiReflectState {
  // 진행 중 판정이 가장 앞선다. needs_reingest가 켜져 있어도 새 요청을 받을 수 없다.
  const isActive =
    document.status === "processing" ||
    (document.processing_state !== undefined &&
      (ACTIVE_PROCESSING_STATES as readonly string[]).includes(document.processing_state));
  if (isActive) return "processing";

  // PDF 변환 완료도 completed이지만 위키 편입을 마쳤다는 뜻은 아니다.
  // 변환 시 두 content hash가 같아 needs_reingest=false여도 최초 편입할 수 있어야 한다.
  if (document.status === "completed" && document.pipeline_run_id?.startsWith("convert:")) {
    return "not-included";
  }

  if (document.needs_reingest === true) return "changed";

  if (document.status === "uploaded") return "not-included";
  if (document.status === "failed") return "retry";

  return "up-to-date";
}

/**
 * 위키 반영이 실제로 돌고 있는 문서.
 * 문서 목록은 새로고침해도 백엔드에서 다시 내려오므로 진행 상태가 유실되지 않는다.
 */
export function selectActiveIngestDocuments(
  documents: DocumentItemResponse[]
): DocumentItemResponse[] {
  return documents.filter((document) => getWikiReflectState(document) === "processing");
}

export function isWikiReflectEligible(document: DocumentItemResponse): boolean {
  // PDF 원본은 편집 불가 문서라 ingest 대상에서 제외한다.
  if (document.mime_type === "application/pdf") return false;
  const state = getWikiReflectState(document);
  return state !== "processing" && state !== "up-to-date";
}

export function getWikiReflectLabel(document: DocumentItemResponse): string | null {
  return WIKI_REFLECT_LABELS[getWikiReflectState(document)] ?? null;
}

export type ChatEvidenceNotice = {
  message: string;
  /** 편입을 요청하는 버튼 문구. 편입이 진행 중이면 누를 것이 없어 null이다. */
  actionLabel: string | null;
};

const CHAT_EVIDENCE_NOTICES: Partial<Record<WikiReflectState, ChatEvidenceNotice>> = {
  "not-included": {
    message: "이 노트는 위키에 편입되지 않아 채팅에서 내용을 찾을 수 없습니다. 위키에 편입하면 이 노트를 근거로 답합니다.",
    actionLabel: "위키에 편입"
  },
  changed: { message: "마지막 편입 이후 수정한 내용은 답변에 반영되지 않습니다.", actionLabel: "수정 내용 반영" },
  retry: { message: "위키 편입에 실패해 이 노트를 답변 근거로 쓸 수 없습니다.", actionLabel: "다시 편입" },
  processing: { message: "위키에 편입하는 중입니다. 끝나면 이 노트를 근거로 답합니다.", actionLabel: null }
};

/**
 * 채팅 답변 근거는 위키 페이지만 검색하므로, 열린 노트의 최신 내용이 편입돼 있지 않으면 상태별 안내를 돌려준다.
 * 최신 내용이 편입돼 있으면 안내하지 않는다. PDF 원본과 PDF 변환 중인 노트는 편입 대상이 아니라 안내하지 않는다.
 */
export function getChatEvidenceNotice(document: DocumentItemResponse | undefined): ChatEvidenceNotice | null {
  if (!document || document.mime_type === "application/pdf") return null;
  const state = getWikiReflectState(document);
  // PDF 변환 중인 노트는 편입 대상이 아니다. documentKind의 isDocumentConverting은 status만 보고,
  // 테스트 런타임에서 @/ alias import가 풀리지 않아 processing_state까지 포함해 여기서 직접 판정한다.
  if (state === "processing" && document.pipeline_run_id?.startsWith("convert:")) return null;
  return CHAT_EVIDENCE_NOTICES[state] ?? null;
}

export function isLintActionEnabled({
  needsLint,
  isIngestActive,
  isLintActive
}: {
  needsLint: boolean;
  isIngestActive: boolean;
  isLintActive: boolean;
}): boolean {
  return needsLint && !isIngestActive && !isLintActive;
}
