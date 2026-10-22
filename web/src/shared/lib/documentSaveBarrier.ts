const pendingDocumentSaves = new Map<string, Promise<boolean>>();
const documentSaveFlushers = new Map<string, () => Promise<boolean>>();

/** 진행 중 저장과, 그동안 뒤에 붙은 저장까지 같은 문서의 작업으로 묶는다. */
export function trackPendingDocumentSave(documentId: string, save: Promise<unknown>): void {
  const previous = pendingDocumentSaves.get(documentId);
  const result = save.then((saved) => saved !== false, () => false);
  const tracked = previous
    ? Promise.all([previous, result]).then((results) => results.every(Boolean))
    : result;
  pendingDocumentSaves.set(documentId, tracked);
  void tracked.then(() => {
    if (pendingDocumentSaves.get(documentId) === tracked) pendingDocumentSaves.delete(documentId);
  });
}

async function drainDocumentSaves(documentId: string): Promise<boolean> {
  let success = true;
  let pending;
  while ((pending = pendingDocumentSaves.get(documentId))) {
    success = (await pending) && success;
  }
  return success;
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
  const success = flush ? await flush() : await drainDocumentSaves(documentId);
  if (!success) throw new Error("문서를 저장하지 못해 위키 편입을 시작하지 않았습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.");
}
