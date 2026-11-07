import { useEffect, useRef, useState } from "react";
import { reflectDocumentToWiki, type DocumentItemResponse } from "@/entities/document";
import { useSelectedWorkspace } from "@/entities/workspace";
import { publishNotice } from "@/features/document-notifications";
import { shouldPromptConvertedIngest } from "@/features/wiki-ingest/model/autoIngestPolicy";
import { useWikiActionPermissions } from "@/features/wiki-ingest/model/useWikiActionPermissions";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";

// 이번 세션에 편입 확인을 거절한 변환본 ID. 워크스페이스마다 따로 둔다.
const DISMISSED_STORAGE_PREFIX = "fruition.converted-ingest-dismissed";

function dismissedStorageKey(): string | null {
  const workspaceId = getSelectedWorkspaceId();
  return workspaceId ? `${DISMISSED_STORAGE_PREFIX}.${workspaceId}` : null;
}

function readDismissedIds(): string[] {
  const key = dismissedStorageKey();
  if (!key) return [];
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
  } catch {
    // 저장소가 막혔거나 값이 손상되면 거절 기록이 없는 것으로 본다.
    return [];
  }
}

function saveDismissedId(documentId: string) {
  const key = dismissedStorageKey();
  if (!key) return;
  try {
    const next = [...readDismissedIds().filter((id) => id !== documentId), documentId];
    window.sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    // 저장하지 못하면 다음에 열 때 한 번 더 물을 뿐이다.
  }
}

/**
 * 화면에 연 PDF 변환본이 아직 위키에 편입되지 않았으면 "이 문서를 위키에 편입할까요?"를 묻는다(shouldPromptConvertedIngest).
 * 같은 문서는 열려 있는 동안 한 번만 묻고, 취소하면 이번 세션에는 다시 묻지 않는다.
 * openDocumentId: 지금 문서 화면에 보이는 문서. pendingDocumentIds: "변환 후 편입"으로 곧 편입될 변환본(usePdfWikiIngest).
 */
export function useConvertedIngestPrompt({
  documents,
  openDocumentId,
  pendingDocumentIds,
  refreshBackendData
}: {
  documents: DocumentItemResponse[];
  openDocumentId: string | null;
  pendingDocumentIds: readonly string[];
  refreshBackendData: () => Promise<void>;
}) {
  const { canIngest } = useWikiActionPermissions();
  const workspace = useSelectedWorkspace();
  const serverAutoIngest = workspace ? workspace.auto_ingest_on_upload === true : null;
  const [target, setTarget] = useState<DocumentItemResponse | null>(null);
  // 이번에 열어 둔 동안 이미 물은 문서. 다른 문서를 열면 비워서 다시 열 때 또 물을 수 있게 한다.
  const promptedIdRef = useRef<string | null>(null);
  const openDocument = openDocumentId ? documents.find((document) => document.id === openDocumentId) : undefined;
  const shouldPrompt = shouldPromptConvertedIngest(openDocument, {
    serverAutoIngest,
    canIngest,
    isDismissed: openDocumentId ? readDismissedIds().includes(openDocumentId) : false,
    isQueued: openDocumentId ? pendingDocumentIds.includes(openDocumentId) : false
  });

  useEffect(() => {
    if (promptedIdRef.current !== openDocumentId) promptedIdRef.current = null;
    if (!shouldPrompt || !openDocument || promptedIdRef.current === openDocument.id) return;
    promptedIdRef.current = openDocument.id;
    setTarget(openDocument);
  }, [openDocument, openDocumentId, shouldPrompt]);

  function cancel() {
    if (target) saveDismissedId(target.id);
    setTarget(null);
  }

  function confirm() {
    if (!target) return;
    const { id, filename } = target;
    setTarget(null);
    // 묻는 동안 편입이 시작됐거나 문서가 사라졌으면 다시 보내지 않는다.
    const latest = documents.find((document) => document.id === id);
    if (!shouldPromptConvertedIngest(latest, { serverAutoIngest, canIngest, isDismissed: false, isQueued: pendingDocumentIds.includes(id) })) return;
    void reflectDocumentToWiki(id, "EDITABLE")
      .then(() => {
        publishNotice({ kind: "completed", title: "위키 편입 요청", message: `${filename}: 위키 편입을 요청했습니다.` });
        return refreshBackendData().catch(() => {});
      })
      .catch((error: unknown) => {
        publishNotice({ kind: "failed", title: "위키 편입 실패", message: `${filename}: ${getErrorMessage(error, "위키 편입에 실패했습니다.")}` });
      });
  }

  return { target, confirm, cancel };
}
