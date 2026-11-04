type Listener = (documentIds: readonly string[]) => void;

const listeners = new Set<Listener>();

/** 편집기 밖(AI 계획)에서 본문이 저장된 문서를 알린다. 문서를 열어 둔 화면이 받아 본문을 다시 읽는다. */
export function publishDocumentContentSaved(documentIds: readonly string[]) {
  if (documentIds.length === 0) return;
  listeners.forEach((listener) => listener(documentIds));
}

export function subscribeDocumentContentSaved(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
