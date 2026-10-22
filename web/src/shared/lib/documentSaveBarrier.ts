type DocumentSaveState = {
  pending: Set<Promise<void>>;
  sequence: number;
  success: boolean;
};
const documentSaves = new Map<string, DocumentSaveState>();
const documentSaveFlushers = new Map<string, () => Promise<boolean>>();

/** 진행 중 저장과, 그동안 뒤에 붙은 저장까지 같은 문서의 작업으로 묶는다. */
export function trackPendingDocumentSave(documentId: string, save: Promise<unknown>): void {
  const state = documentSaves.get(documentId) ?? { pending: new Set<Promise<void>>(), sequence: 0, success: true };
  documentSaves.set(documentId, state);
  const sequence = ++state.sequence;
  const tracked = save.then((saved) => saved !== false, () => false).then((success) => {
    // 가장 최근에 시작한 실제 저장이 최신 본문을 소유한다. 앞선 실패로 이후 성공을 취소하지 않는다.
    if (state.sequence === sequence) state.success = success;
    state.pending.delete(tracked);
    // 실패는 편집기를 떠난 뒤에도 기억하고, 다음 저장이 성공했을 때만 해제한다.
    if (state.pending.size === 0 && state.success) documentSaves.delete(documentId);
  });
  state.pending.add(tracked);
}

async function drainDocumentSaves(documentId: string): Promise<boolean> {
  let state;
  while ((state = documentSaves.get(documentId)) && state.pending.size > 0) {
    await Promise.all(state.pending);
  }
  return documentSaves.get(documentId)?.success ?? true;
}

/** 문서를 다시 열 때 언마운트 직전 시작한 저장과 대기열이 끝나기를 기다린다. */
export async function waitForPendingDocumentSave(documentId: string): Promise<void> {
  await drainDocumentSaves(documentId);
}

export function registerDocumentSaveFlusher(documentId: string, flush: () => Promise<boolean>): () => void {
  documentSaveFlushers.set(documentId, flush);
  return () => {
    if (documentSaveFlushers.get(documentId) === flush) documentSaveFlushers.delete(documentId);
  };
}

/** 디바운스 대기·자동 저장 꺼짐·문서 이동 중 저장까지 끝낸 뒤에만 편입할 수 있다. */
export async function flushPendingDocumentSave(documentId: string): Promise<void> {
  const flush = documentSaveFlushers.get(documentId);
  const flushed = flush ? await flush() : true;
  if (!flushed || !await drainDocumentSaves(documentId)) {
    throw new Error("문서를 저장하지 못해 위키 편입을 시작하지 않았습니다. 문서를 다시 열어 저장한 뒤 다시 시도해 주세요.");
  }
}
