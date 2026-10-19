import { useQueries } from "@tanstack/react-query";
import { fetchDocumentVersions } from "@/features/note-editing/api/versions";
import { fetchAgentTurnApplyTarget } from "../api/agent";
import { collectServerAppliedTurnIds, isServerAppliableTask, type TaskApplyTarget, type TaskMessageItem } from "../lib/taskThread";

/**
 * 편집 작업(markdown_edit)이 실제로 저장됐는지 서버 기록으로 확인한다.
 * turn에서 대상 문서·apply_operation_id를 받고, 그 문서 버전 목록에 같은 operation_id가 있으면 적용된 것이다.
 * 이 화면에서 적용한 기록(appliedTurnIds)은 새로 고침하면 사라지므로 이것으로 "저장됨"을 다시 세운다.
 */
export function useServerAppliedTurnIds(workspaceId: string, items: TaskMessageItem[], isShown: boolean): ReadonlySet<string> {
  const editItems = items.filter(isServerAppliableTask);
  const turnQueries = useQueries({
    queries: editItems.map((item) => ({
      queryKey: ["agentTurnApplyTarget", workspaceId, item.turnId],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchAgentTurnApplyTarget(workspaceId, item.turnId!, signal),
      enabled: isShown,
      retry: false,
      // 끝난 turn의 대상 문서·적용 ID는 바뀌지 않는다.
      staleTime: Infinity
    }))
  });
  const targets: TaskApplyTarget[] = editItems.flatMap((item, index) => {
    const data = turnQueries[index]?.data;
    return data ? [{ turnId: item.turnId!, ...data }] : [];
  });
  const documentIds = [...new Set(targets.flatMap((target) => (target.documentId && target.applyOperationId ? [target.documentId] : [])))];
  const versionQueries = useQueries({
    queries: documentIds.map((documentId) => ({
      queryKey: ["document-versions", documentId],
      queryFn: () => fetchDocumentVersions(documentId),
      enabled: isShown,
      retry: false
    }))
  });
  const versionsByDocument = new Map(
    documentIds.flatMap((documentId, index) => {
      const data = versionQueries[index]?.data;
      return data ? [[documentId, data.versions] as const] : [];
    })
  );
  return collectServerAppliedTurnIds(targets, versionsByDocument);
}
